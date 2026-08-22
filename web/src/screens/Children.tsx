import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { StatusPill } from '../components/ui';
import './Forms.css';

interface Dose {
  vaccineCode: string;
  displayName: string;
  doseNumber: number;
  dueDate: string;
  administeredDate: string | null;
}
interface ChildView {
  chin: string;
  fullName: string;
  sex: string;
  dateOfBirth: string;
  status: string;
  doses: Dose[];
  completedAt: string | null;
}
interface Facility {
  _id: string;
  name: string;
  lgaName: string;
  stateName: string;
}

export function Children() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  useEffect(() => {
    api.get<Facility[]>('/api/facilities').then(setFacilities).catch(() => undefined);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Registry</div>
        <h1>Children</h1>
      </div>
      <div className="two-col">
        <LookupPanel facilities={facilities} />
        <RegisterPanel facilities={facilities} />
      </div>
    </div>
  );
}

function LookupPanel({ facilities }: { facilities: Facility[] }) {
  const [chin, setChin] = useState('');
  const [child, setChild] = useState<ChildView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<string | null>(null);

  async function load(target?: string) {
    const c = (target ?? chin).trim().toUpperCase();
    if (!c) return;
    setError('');
    setBusy(true);
    setCard(null);
    try {
      setChild(await api.get<ChildView>(`/api/children/${encodeURIComponent(c)}`));
    } catch (err) {
      setChild(null);
      setError(err instanceof ApiError ? err.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  }

  async function recordDose(d: Dose) {
    if (!child) return;
    const facilityId = facilities[0]?._id;
    if (!facilityId) {
      setError('Register a facility first.');
      return;
    }
    try {
      await api.post(`/api/children/${encodeURIComponent(child.chin)}/doses`, {
        vaccineCode: d.vaccineCode,
        doseNumber: d.doseNumber,
        facilityId
      });
      await load(child.chin);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record dose');
    }
  }

  async function showCard() {
    if (!child) return;
    try {
      setCard(await api.getText(`/api/children/${encodeURIComponent(child.chin)}/card.svg`));
    } catch {
      setError('Could not load the card');
    }
  }

  return (
    <section className="card panel">
      <h2>Look up a child</h2>
      <form
        className="lookup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          className="input mono"
          placeholder="CHN-XXXX-XXXX-X"
          value={chin}
          onChange={(e) => setChin(e.target.value)}
          aria-label="CHIN"
        />
        <button className="btn btn-primary" disabled={busy || !chin.trim()}>Find</button>
      </form>

      {error && <div className="banner error">{error}</div>}

      {child && (
        <div className="child">
          <div className="child-head">
            <div>
              <div className="child-name">{child.fullName}</div>
              <div className="mono muted child-chin">{child.chin}</div>
            </div>
            <StatusPill status={child.status} />
          </div>
          <div className="muted child-meta">
            {child.sex} · born {child.dateOfBirth.slice(0, 10)}
          </div>

          <div className="dose-list">
            {child.doses.map((d) => (
              <div key={`${d.vaccineCode}#${d.doseNumber}`} className="dose-row">
                <span className="dose-name">{d.displayName} <span className="muted">#{d.doseNumber}</span></span>
                {d.administeredDate ? (
                  <span className="dose-done mono">✓ {d.administeredDate.slice(0, 10)}</span>
                ) : (
                  <button className="btn dose-btn" onClick={() => void recordDose(d)}>Record</button>
                )}
              </div>
            ))}
          </div>

          <div className="child-actions">
            <button className="btn" onClick={() => void showCard()}>Show card</button>
          </div>
          {card && <div className="card-preview" dangerouslySetInnerHTML={{ __html: card }} />}
        </div>
      )}
    </section>
  );
}

function RegisterPanel({ facilities }: { facilities: Facility[] }) {
  const [fullName, setFullName] = useState('');
  const [sex, setSex] = useState('female');
  const [dob, setDob] = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!facilityId && facilities[0]) setFacilityId(facilities[0]._id);
  }, [facilities, facilityId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg({});
    setBusy(true);
    try {
      const cg = await api.post<{ _id: string }>('/api/caregivers', { fullName: caregiverName, phone: caregiverPhone });
      const child = await api.post<{ chin: string }>('/api/children', {
        fullName,
        sex,
        dateOfBirth: dob,
        caregiverId: cg._id,
        homeFacilityId: facilityId
      });
      setMsg({ ok: `Registered. CHIN issued: ${child.chin}` });
      setFullName('');
      setDob('');
      setCaregiverName('');
      setCaregiverPhone('');
    } catch (err) {
      setMsg({ err: err instanceof ApiError ? err.message : 'Registration failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card panel">
      <h2>Register a new child</h2>
      <form className="reg-form" onSubmit={onSubmit}>
        <div className="field">
          <label>Child's full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="reg-row">
          <div className="field">
            <label>Sex</label>
            <select className="input" value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div className="field">
            <label>Date of birth</label>
            <input className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label>Home facility</label>
          <select className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required>
            {facilities.length === 0 && <option value="">No facilities registered</option>}
            {facilities.map((f) => (
              <option key={f._id} value={f._id}>{f.name} — {f.lgaName}, {f.stateName}</option>
            ))}
          </select>
        </div>
        <div className="reg-row">
          <div className="field">
            <label>Parent / guardian</label>
            <input className="input" value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Phone</label>
            <input className="input" value={caregiverPhone} onChange={(e) => setCaregiverPhone(e.target.value)} placeholder="+234…" />
          </div>
        </div>

        {msg.err && <div className="banner error">{msg.err}</div>}
        {msg.ok && <div className="banner ok mono">{msg.ok}</div>}

        <button className="btn btn-primary" disabled={busy || !facilityId}>
          {busy ? 'Registering…' : 'Register child'}
        </button>
      </form>
    </section>
  );
}
