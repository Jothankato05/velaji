import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import './Register.css';

interface Facility {
  _id: string;
  name: string;
  lgaName: string;
  stateName: string;
}

/** Shared with point of care: the clinic this device records at. */
const FACILITY_KEY = 'velaji.facility';
/** Velaji follows children under five (the server enforces the same). */
const MAX_AGE_YEARS = 5;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function readSavedFacility(): string {
  try {
    return localStorage.getItem(FACILITY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function Register() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [fullName, setFullName] = useState('');
  const [sex, setSex] = useState('female');
  const [dob, setDob] = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [birthSetting, setBirthSetting] = useState('facility');
  const [channel, setChannel] = useState('phc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingChin, setExistingChin] = useState('');
  const [issued, setIssued] = useState<{ chin: string; name: string; card: string } | null>(null);

  useEffect(() => {
    api.get<Facility[]>('/api/facilities').then((f) => {
      setFacilities(f);
      const saved = readSavedFacility();
      setFacilityId(f.some((x) => x._id === saved) ? saved : (f[0]?._id ?? ''));
    }).catch(() => undefined);
  }, []);

  const today = new Date();
  const oldest = new Date(today);
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setExistingChin('');
    setBusy(true);
    try {
      // One request: the caregiver is only created if the child is accepted.
      const child = await api.post<{ chin: string; fullName: string }>('/api/children', {
        fullName: fullName.trim(),
        sex,
        dateOfBirth: dob,
        caregiver: { fullName: caregiverName.trim(), phone: caregiverPhone.trim() },
        homeFacilityId: facilityId,
        birthSetting,
        registrationChannel: channel
      });
      // The output of registration is the card, so fetch and show it at once.
      const card = await api.getText(`/api/children/${encodeURIComponent(child.chin)}/card.svg`);
      setIssued({ chin: child.chin, name: child.fullName, card });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setExistingChin((err.data as { existingChin?: string })?.existingChin ?? '');
      }
      setError(err instanceof ApiError ? err.message : 'Registration failed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function registerAnother() {
    // Keep the clinic and channel: a registration session is usually one place.
    setIssued(null);
    setFullName('');
    setDob('');
    setCaregiverName('');
    setCaregiverPhone('');
    setBirthSetting('facility');
  }

  if (issued) {
    return (
      <div className="reg">
        <div className="reg-head">
          <h1>{issued.name} is registered</h1>
          <p className="muted reg-sub">
            CHIN <strong className="reg-chin">{issued.chin}</strong>. Print the card and give it to the family; any
            clinic can scan it to see the child's record and what's due.
          </p>
        </div>

        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the card is SVG our own API renders from the child record, not user HTML */}
        <div className="issued-card" dangerouslySetInnerHTML={{ __html: issued.card }} />

        <div className="issued-actions">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print card</button>
          <Link className="btn" to={`/care?chin=${encodeURIComponent(issued.chin)}`}>Record birth vaccines</Link>
          <button type="button" className="btn" onClick={registerAnother}>Register another child</button>
        </div>
      </div>
    );
  }

  return (
    <div className="reg">
      <div className="reg-head">
        <h1>Register a child</h1>
        <p className="muted reg-sub">Creates the child's Child Health ID (CHIN) and prints their card.</p>
      </div>

      <form className="reg-form card" onSubmit={onSubmit}>
        <fieldset className="reg-section">
          <legend>Child</legend>
          <div className="field">
            <label htmlFor="reg-name">Full name</label>
            <input id="reg-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus autoComplete="off" />
          </div>
          <div className="reg-row">
            <div className="field">
              <label htmlFor="reg-sex">Sex</label>
              <select id="reg-sex" className="input" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="reg-dob">Date of birth</label>
              <input
                id="reg-dob"
                className="input"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                min={isoDay(oldest)}
                max={isoDay(today)}
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reg-birth-setting">Where was the child born?</label>
            <select id="reg-birth-setting" className="input" value={birthSetting} onChange={(e) => setBirthSetting(e.target.value)}>
              <option value="facility">In a health facility</option>
              <option value="home">At home</option>
              <option value="other">Other</option>
            </select>
          </div>
        </fieldset>

        <fieldset className="reg-section">
          <legend>Parent or guardian</legend>
          <div className="reg-row">
            <div className="field">
              <label htmlFor="reg-caregiver">Full name</label>
              <input id="reg-caregiver" className="input" value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} required autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="reg-phone">Phone number</label>
              <input
                id="reg-phone"
                className="input"
                type="tel"
                inputMode="tel"
                value={caregiverPhone}
                onChange={(e) => setCaregiverPhone(e.target.value)}
                placeholder="0803 123 4567"
                pattern="\+?[0-9][0-9 \-]{9,}"
                title="A phone number with at least 10 digits, e.g. 0803 123 4567"
                required
              />
            </div>
          </div>
          <p className="muted reg-hint">Vaccine reminders go to this number by SMS, and it works for USSD on a basic phone.</p>
        </fieldset>

        <fieldset className="reg-section">
          <legend>Registration</legend>
          <div className="reg-row">
            <div className="field">
              <label htmlFor="reg-facility">Home clinic</label>
              <select id="reg-facility" className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)} required>
                {facilities.length === 0 && <option value="">No clinics registered</option>}
                {facilities.map((f) => (
                  <option key={f._id} value={f._id}>{f.name}, {f.lgaName}, {f.stateName}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reg-channel">Registered through</label>
              <select id="reg-channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="phc">Primary health centre</option>
                <option value="hospital">Hospital</option>
                <option value="chw">Community health worker</option>
                <option value="mobile_team">Mobile registration team</option>
                <option value="outreach">Outreach programme</option>
                <option value="npc">NPC registration point</option>
              </select>
            </div>
          </div>
        </fieldset>

        {error && (
          <div className="banner error" role="alert">
            {error}
            {existingChin && (
              <div className="reg-dup-actions">
                <Link className="btn btn-sm" to={`/care?chin=${encodeURIComponent(existingChin)}`}>Open {existingChin}</Link>
              </div>
            )}
          </div>
        )}

        <button type="submit" className="btn btn-primary reg-submit" disabled={busy || !facilityId}>
          {busy ? 'Registering…' : 'Register and create card'}
        </button>
      </form>
    </div>
  );
}
