import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import './Register.css';

interface Facility {
  _id: string;
  name: string;
  lgaName: string;
  stateName: string;
}

export function Register() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [fullName, setFullName] = useState('');
  const [sex, setSex] = useState('female');
  const [dob, setDob] = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<{ chin: string; card: string } | null>(null);

  useEffect(() => {
    api.get<Facility[]>('/api/facilities').then((f) => {
      setFacilities(f);
      if (f[0]) setFacilityId(f[0]._id);
    }).catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
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
      // The output of registration IS the card — fetch and show it at once.
      const card = await api.getText(`/api/children/${encodeURIComponent(child.chin)}/card.svg`);
      setIssued({ chin: child.chin, card });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  function registerAnother() {
    setIssued(null);
    setFullName('');
    setDob('');
    setCaregiverName('');
    setCaregiverPhone('');
  }

  if (issued) {
    return (
      <div className="reg">
        <div className="reg-head">
          <div className="eyebrow">Registered · card issued</div>
          <h1>The card is ready. Give it to the family.</h1>
          <p className="muted reg-sub">
            They carry this card anywhere in Nigeria. At any facility it tells the system who the child
            is and which vaccine is next — no paper record to lose, nothing to remember.
          </p>
        </div>

        <div className="issued-card" dangerouslySetInnerHTML={{ __html: issued.card }} />

        <div className="issued-actions">
          <button className="btn btn-primary" onClick={() => window.print()}>Print card</button>
          <button className="btn" onClick={registerAnother}>Register another child</button>
        </div>
      </div>
    );
  }

  return (
    <div className="reg">
      <div className="reg-head">
        <div className="eyebrow">Registry · birth &amp; first contact</div>
        <h1>Register a child</h1>
        <p className="muted reg-sub">
          Registering issues the child's Child Health ID and prints their card — the start of the record
          that follows them for life.
        </p>
      </div>

      <form className="reg-form card" onSubmit={onSubmit}>
        <div className="field">
          <label>Child's full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
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

        {error && <div className="banner error">{error}</div>}

        <button className="btn btn-primary reg-submit" disabled={busy || !facilityId}>
          {busy ? 'Issuing card…' : 'Register & print card'}
        </button>
      </form>
    </div>
  );
}
