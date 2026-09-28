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

const DAY = 86400000;
/** Doses due within this many days can be given at today's visit (the "due soon" window). */
const VISIT_WINDOW_DAYS = 7;
/** The clinic is chosen once per device, not on every visit. */
const FACILITY_KEY = 'velaji.facility';

const doseKey = (d: Pick<Dose, 'vaccineCode' | 'doseNumber'>) => `${d.vaccineCode}#${d.doseNumber}`;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "36 days overdue", "due today", "due in 3 days". */
function relative(iso: string, now = Date.now()): string {
  const days = Math.round((new Date(iso).getTime() - now) / DAY);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `due in ${days} day${days === 1 ? '' : 's'}`;
}

function doseLabel(d: Pick<Dose, 'displayName' | 'doseNumber'>): string {
  if (d.doseNumber !== 0) return `${d.displayName}, dose ${d.doseNumber}`;
  // Some schedule names already say so, e.g. "Hepatitis B (birth dose)".
  return /birth dose/i.test(d.displayName) ? d.displayName : `${d.displayName}, birth dose`;
}

function ageLabel(dob: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(dob).getTime()) / DAY);
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} old`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months old`;
  return `${Math.floor(months / 12)} years old`;
}

function readSavedFacility(): string {
  try {
    return localStorage.getItem(FACILITY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function PointOfCare() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [hereId, setHereId] = useState('');
  const [value, setValue] = useState('');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [giving, setGiving] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    api.get<Facility[]>('/api/facilities').then((f) => {
      setFacilities(f);
      const saved = readSavedFacility();
      setHereId(f.some((x) => x._id === saved) ? saved : (f[0]?._id ?? ''));
    }).catch(() => undefined);
  }, []);

  function chooseFacility(id: string) {
    setHereId(id);
    try {
      localStorage.setItem(FACILITY_KEY, id);
    } catch {
      // Not remembered on this device; the choice still applies to this visit.
    }
  }

  // Until this device has a chosen clinic, assume the child's own. Runs once
  // both have loaded, whichever arrives first.
  useEffect(() => {
    if (!journey || readSavedFacility()) return;
    const own = facilities.find((f) => f.name === journey.currentFacility);
    if (own) setHereId(own._id);
  }, [journey, facilities]);

  // A CHIN handed in from the top-bar search loads straight away, including
  // when this screen is already open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the URL only; clears the param itself
  useEffect(() => {
    const chin = params.get('chin');
    if (chin) {
      setValue(chin);
      void load(chin);
      setParams({}, { replace: true });
    }
  }, [params]);

  async function load(chin: string, keepNotice = false) {
    setError('');
    if (!keepNotice) setNotice('');
    setBusy(true);
    try {
      const j = await api.get<Journey>(`/api/children/${encodeURIComponent(chin)}/journey`);
      setJourney(j);
      // Everything due at this visit starts ticked; the nurse unticks what isn't given.
      setSelected(new Set(dueNow(j).map(doseKey)));
    } catch (err) {
      setJourney(null);
      setError(
        err instanceof ApiError && err.status === 404
          ? `No child found with CHIN ${chin}. Check the number on the card and try again.`
          : err instanceof ApiError ? err.message : 'Could not look up this card. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  function onScan(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    // A scanned QR is a card link ending in the CHIN; a typed value is the CHIN.
    let chin = v.toUpperCase();
    if (/^https?:\/\//i.test(v)) {
      try {
        chin = decodeURIComponent(new URL(v).pathname.split('/').filter(Boolean).pop() ?? '').toUpperCase();
      } catch {
        // Not a usable link: look it up as typed and let the server say so.
      }
    }
    void load(chin);
  }

  function toggle(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function recordSelected() {
    if (!journey || !hereId || selected.size === 0) return;
    const doses = dueNow(journey).filter((d) => selected.has(doseKey(d)));
    setGiving(true);
    setError('');
    setNotice('');
    let recorded = 0;
    try {
      // One at a time: each write saves the same child record.
      for (const d of doses) {
        await api.post(`/api/children/${encodeURIComponent(journey.chin)}/doses`, {
          vaccineCode: d.vaccineCode,
          doseNumber: d.doseNumber,
          facilityId: hereId
        });
        recorded++;
      }
      setNotice(`Recorded ${recorded} vaccine${recorded === 1 ? '' : 's'} for ${journey.fullName}.`);
    } catch (err) {
      const why = err instanceof ApiError ? err.message : 'Could not record the vaccine.';
      setError(recorded ? `Recorded ${recorded} of ${doses.length}, then stopped: ${why}` : why);
    } finally {
      setGiving(false);
      await load(journey.chin, true);
    }
  }

  const facility = facilities.find((f) => f._id === hereId);
  const due = journey ? dueNow(journey) : [];

  return (
    <div className="poc">
      <div className="poc-head">
        <div>
          <h1>Point of care</h1>
          <p className="muted poc-sub">Scan the child's card or enter their CHIN to see what's due.</p>
        </div>
        {facilities.length > 0 && (
          <label className="poc-here">
            <span className="eyebrow">Recording at</span>
            <select className="input" value={hereId} onChange={(e) => chooseFacility(e.target.value)}>
              {facilities.map((f) => (
                <option key={f._id} value={f._id}>{f.name}, {f.stateName}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <form className="poc-scan" onSubmit={onScan}>
        <input
          className="input poc-scan-input"
          placeholder="Scan the card's QR, or type the CHIN"
          aria-label="CHIN or scanned card"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      {error && <div className="banner error" role="alert">{error}</div>}
      {notice && <div className="banner ok" role="status">{notice}</div>}

      {journey && (
        <div className="journey">
          <div className="journey-child card">
            <div className="jc-top">
              <div>
                <div className="jc-name">{journey.fullName}</div>
                <div className="muted jc-chin">{journey.chin}</div>
              </div>
              <StatusPill status={journey.status} />
            </div>
            <div className="muted jc-meta">
              <span className="jc-sex">{journey.sex}</span> · {ageLabel(journey.dateOfBirth)} (born {fmtDate(journey.dateOfBirth)})
              {journey.currentFacility ? ` · ${journey.currentFacility}` : ''}
            </div>
            <ProgressTrack progress={journey.progress} complete={Boolean(journey.completedAt)} />
          </div>

          {due.length > 0 ? (
            <div className="visit card">
              <h2>Due at this visit</h2>
              <p className="muted visit-sub">Untick anything not given today.</p>
              <ul className="visit-list">
                {due.map((d) => {
                  const key = doseKey(d);
                  const overdue = new Date(d.dueDate).getTime() < Date.now() - DAY;
                  return (
                    <li key={key}>
                      <label className="visit-row">
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                        <span className="visit-name">{doseLabel(d)}</span>
                        <span className={`visit-when${overdue ? ' overdue' : ''}`}>
                          {relative(d.dueDate)}
                          <span className="muted visit-date"> · {fmtDate(d.dueDate)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="btn btn-primary visit-give"
                onClick={() => void recordSelected()}
                disabled={giving || selected.size === 0 || !hereId}
              >
                {giving ? 'Recording…' : `Record ${selected.size} vaccine${selected.size === 1 ? '' : 's'}`}
              </button>
              {facility && <p className="muted visit-at">Recorded as given today at {facility.name}.</p>}
            </div>
          ) : journey.nextDue ? (
            <div className="visit card">
              <h2>Nothing due today</h2>
              <p className="visit-next">
                Next: <strong>{journey.nextDue.vaccine}</strong> on {fmtDate(journey.nextDue.dueDate)} ({relative(journey.nextDue.dueDate)}).
              </p>
            </div>
          ) : (
            journey.coverage && <CoveragePayoff coverage={journey.coverage} />
          )}

          <details className="history card">
            <summary>Vaccination history ({journey.progress.administered} of {journey.progress.total} given)</summary>
            <ul className="history-list">
              {[...journey.doses]
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                .map((d) => (
                  <li key={doseKey(d)} className={d.administeredDate ? 'given' : ''}>
                    <span>{doseLabel(d)}</span>
                    <span className="muted">
                      {d.administeredDate ? `given ${fmtDate(d.administeredDate)}` : `due ${fmtDate(d.dueDate)}`}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/** Not yet given, and overdue or falling due within the visit window. */
function dueNow(j: Journey): Dose[] {
  const cutoff = Date.now() + VISIT_WINDOW_DAYS * DAY;
  return j.doses
    .filter((d) => !d.administeredDate && new Date(d.dueDate).getTime() <= cutoff)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

function ProgressTrack({ progress, complete }: { progress: Journey['progress']; complete: boolean }) {
  const pct = progress.total ? (progress.administered / progress.total) * 100 : 0;
  return (
    <div className="track">
      <div className="track-bar">
        <div className={`track-fill${complete ? ' done' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="track-label">
        {progress.administered} of {progress.total} doses given
        <span className="muted"> · {complete ? 'schedule complete' : `${progress.remaining} more to complete the schedule and unlock Healthy Start cover`}</span>
      </div>
    </div>
  );
}

function CoveragePayoff({ coverage }: { coverage: Coverage }) {
  return (
    <div className="payoff card">
      <h2 className="payoff-title">Schedule complete: {coverage.programme} cover {coverage.active ? 'active' : 'ended'}</h2>
      <p className="payoff-desc">
        {coverage.months} months of NHIA child health cover, {fmtDate(coverage.startsAt)} to {fmtDate(coverage.expiresAt)}.
      </p>
      <p className="muted payoff-note">Recorded in Velaji. The link to NHIA's own systems isn't connected yet.</p>
    </div>
  );
}
