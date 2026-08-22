import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { StatusPill } from '../components/ui';
import './PointOfCare.css';

interface Dose {
  vaccineCode: string;
  displayName: string;
  doseNumber: number;
  dueDate: string;
  administeredDate: string | null;
}
interface Coverage {
  programme: string;
  months: number;
  startsAt: string;
  expiresAt: string;
  active: boolean;
}
interface Journey {
  chin: string;
  fullName: string;
  sex: string;
  dateOfBirth: string;
  status: string;
  currentFacility: string | null;
  progress: { administered: number; total: number; remaining: number };
  nextDue: { vaccine: string; vaccineCode: string; doseNumber: number; dueDate: string } | null;
  completedAt: string | null;
  coverage: Coverage | null;
  doses: Dose[];
}
interface Facility {
  _id: string;
  name: string;
  lgaName: string;
  stateName: string;
}

export function PointOfCare() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [hereId, setHereId] = useState('');
  const [value, setValue] = useState('');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [giving, setGiving] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    api.get<Facility[]>('/api/facilities').then((f) => {
      setFacilities(f);
      if (f[0]) setHereId(f[0]._id);
    }).catch(() => undefined);
  }, []);

  // A CHIN handed in from the top-bar search loads straight away.
  useEffect(() => {
    const chin = params.get('chin');
    if (chin) {
      setValue(chin);
      void load(chin);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(chin: string) {
    setError('');
    setBusy(true);
    try {
      setJourney(await api.get<Journey>(`/api/children/${encodeURIComponent(chin)}/journey`));
    } catch (err) {
      setJourney(null);
      setError(err instanceof ApiError ? err.message : 'Card not recognised');
    } finally {
      setBusy(false);
    }
  }

  function onScan(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    // A scanned QR is a URL ending in the CHIN; a typed value is the CHIN.
    const chin = /\/verify\//.test(v) ? decodeURIComponent(v.split('/verify/')[1].split('?')[0]) : v.toUpperCase();
    void load(chin);
  }

  async function giveNext() {
    if (!journey?.nextDue || !hereId) return;
    setGiving(true);
    setError('');
    try {
      await api.post(`/api/children/${encodeURIComponent(journey.chin)}/doses`, {
        vaccineCode: journey.nextDue.vaccineCode,
        doseNumber: journey.nextDue.doseNumber,
        facilityId: hereId
      });
      await load(journey.chin); // advances to the next dose (or completion)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the vaccine');
    } finally {
      setGiving(false);
    }
  }

  return (
    <div className="poc">
      <div className="poc-head">
        <div>
          <div className="eyebrow">Point of care</div>
          <h1>Present the card. The system remembers the rest.</h1>
        </div>
        {facilities.length > 0 && (
          <label className="poc-here">
            <span className="eyebrow">This facility</span>
            <select className="input" value={hereId} onChange={(e) => setHereId(e.target.value)}>
              {facilities.map((f) => (
                <option key={f._id} value={f._id}>{f.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <form className="poc-scan" onSubmit={onScan}>
        <input
          className="input mono poc-scan-input"
          placeholder="Scan the card's QR, or type the CHIN"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" disabled={busy || !value.trim()}>Look up</button>
      </form>

      {error && <div className="banner error">{error}</div>}

      {journey && (
        <div className="journey">
          <div className="journey-child card">
            <div className="jc-top">
              <div>
                <div className="jc-name">{journey.fullName}</div>
                <div className="mono muted jc-chin">{journey.chin}</div>
              </div>
              <StatusPill status={journey.status} />
            </div>
            <div className="muted jc-meta">
              {journey.sex} · born {journey.dateOfBirth.slice(0, 10)}
              {journey.currentFacility ? ` · ${journey.currentFacility}` : ''}
            </div>

            <ProgressTrack progress={journey.progress} complete={Boolean(journey.completedAt)} />
          </div>

          {/* the ONE next action, or the payoff */}
          {journey.nextDue ? (
            <div className="next card">
              <div className="eyebrow">Next vaccine — the system chose this, not the parent</div>
              <div className="next-vaccine">{journey.nextDue.vaccine}</div>
              <div className="next-meta">
                dose #{journey.nextDue.doseNumber} · due {journey.nextDue.dueDate.slice(0, 10)}
              </div>
              <button className="btn btn-primary next-give" onClick={() => void giveNext()} disabled={giving || !hereId}>
                {giving ? 'Recording…' : 'Record this vaccine'}
              </button>
            </div>
          ) : (
            journey.coverage && <CoveragePayoff coverage={journey.coverage} />
          )}
        </div>
      )}
    </div>
  );
}

function ProgressTrack({ progress, complete }: { progress: Journey['progress']; complete: boolean }) {
  const pct = progress.total ? (progress.administered / progress.total) * 100 : 0;
  return (
    <div className="track">
      <div className="track-bar">
        <div className={`track-fill${complete ? ' done' : ''}`} style={{ width: `${pct}%` }} />
        <div className="track-flag" title="Completion → NHIA coverage">◈</div>
      </div>
      <div className="track-label mono">
        {progress.administered} of {progress.total} vaccines
        <span className="muted"> · {complete ? 'schedule complete' : `${progress.remaining} to go before coverage`}</span>
      </div>
    </div>
  );
}

function CoveragePayoff({ coverage }: { coverage: Coverage }) {
  return (
    <div className="payoff card">
      <div className="payoff-badge">◈</div>
      <div className="payoff-body">
        <div className="eyebrow">Immunisation complete · NCIHAP §12</div>
        <h2 className="payoff-title">NHIA “{coverage.programme}” coverage unlocked</h2>
        <p className="payoff-desc">
          {coverage.months} months of sponsored child health coverage, from{' '}
          {coverage.startsAt.slice(0, 10)} to {coverage.expiresAt.slice(0, 10)}.
        </p>
        <div className="payoff-note eyebrow">
          coverage recorded in-system · NHIA integration: not connected (stub)
        </div>
      </div>
    </div>
  );
}
