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

interface KnownParent {
  _id: string;
  fullName: string;
  phone: string;
  children: Array<{ chin: string; fullName: string; dateOfBirth: string }>;
}

/** "3 days old", "5 months old": read back so a mistyped year stands out. */
function ageFrom(dob: string): string {
  const days = Math.floor((Date.now() - new Date(`${dob}T12:00:00`).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return '';
  if (days === 0) return 'Born today';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} old`;
  if (days < 60) return `${Math.floor(days / 7)} weeks old`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months old`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} year${years === 1 ? '' : 's'}${rest ? ` ${rest} month${rest === 1 ? '' : 's'}` : ''} old`;
}

const digitsIn = (s: string) => s.replace(/\D/g, '').length;

function saveFacility(id: string) {
  try {
    localStorage.setItem(FACILITY_KEY, id);
  } catch {
    // Private mode: they'll just choose again next time.
  }
}

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
  const [sex, setSex] = useState('');
  const [dob, setDob] = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [facilitiesError, setFacilitiesError] = useState(false);
  const [facilitiesAttempt, setFacilitiesAttempt] = useState(0);
  // A parent already on file with this phone: offered, then linked if confirmed.
  const [knownParents, setKnownParents] = useState<KnownParent[]>([]);
  const [linkedParent, setLinkedParent] = useState<KnownParent | null>(null);
  const [dismissedPhone, setDismissedPhone] = useState('');
  const [birthSetting, setBirthSetting] = useState('facility');
  const [channel, setChannel] = useState('phc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingChin, setExistingChin] = useState('');
  const [issued, setIssued] = useState<{ chin: string; name: string; card: string; parent: KnownParent } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: facilitiesAttempt is the retry trigger
  useEffect(() => {
    setFacilitiesError(false);
    api.get<Facility[]>('/api/facilities').then((f) => {
      setFacilities(f);
      const saved = readSavedFacility();
      // The clinic this device last used; otherwise staff choose, rather than
      // the child silently getting whichever clinic sorts first.
      setFacilityId(f.some((x) => x._id === saved) ? saved : f.length === 1 ? f[0]._id : '');
    }).catch(() => setFacilitiesError(true));
  }, [facilitiesAttempt]);

  // Once a full number is typed, look for a parent already registered with it.
  useEffect(() => {
    if (linkedParent || digitsIn(caregiverPhone) < 10) {
      setKnownParents([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      api.get<{ caregivers: KnownParent[] }>(`/api/caregivers/by-phone?phone=${encodeURIComponent(caregiverPhone)}`)
        .then((r) => live && setKnownParents(r.caregivers.filter((c) => c.children.length > 0)))
        .catch(() => live && setKnownParents([]));
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [caregiverPhone, linkedParent]);

  function linkParent(p: KnownParent) {
    setLinkedParent(p);
    setCaregiverName(p.fullName);
    setCaregiverPhone(p.phone);
    setKnownParents([]);
  }

  function unlinkParent() {
    setLinkedParent(null);
    setCaregiverName('');
    setDismissedPhone('');
  }

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
      const child = await api.post<{ chin: string; fullName: string; caregiverId: string }>('/api/children', {
        fullName: fullName.trim(),
        sex,
        dateOfBirth: dob,
        ...(linkedParent
          ? { caregiverId: linkedParent._id }
          : { caregiver: { fullName: caregiverName.trim(), phone: caregiverPhone.trim() } }),
        homeFacilityId: facilityId,
        birthSetting,
        registrationChannel: channel
      });
      // The output of registration is the card, so fetch and show it at once.
      const card = await api.getText(`/api/children/${encodeURIComponent(child.chin)}/card.svg`);
      const parent: KnownParent = linkedParent ?? {
        _id: child.caregiverId, fullName: caregiverName.trim(), phone: caregiverPhone.trim(), children: []
      };
      setIssued({
        chin: child.chin, name: child.fullName, card,
        parent: { ...parent, children: [{ chin: child.chin, fullName: child.fullName, dateOfBirth: dob }, ...parent.children] }
      });
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setExistingChin((err.data as { existingChin?: string })?.existingChin ?? '');
      }
      setError(err instanceof ApiError ? err.message : 'Registration failed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function registerAnother(sibling: boolean) {
    // Keep the clinic and channel: a registration session is usually one place.
    // A sibling (or twin) keeps the parent too.
    const parent = issued?.parent ?? null;
    setIssued(null);
    setFullName('');
    setSex('');
    setBirthSetting('facility');
    setError('');
    if (sibling && parent) {
      linkParent(parent);
    } else {
      setDob('');
      setLinkedParent(null);
      setCaregiverName('');
      setCaregiverPhone('');
      setDismissedPhone('');
    }
    window.scrollTo(0, 0);
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
          <button type="button" className="btn" onClick={() => registerAnother(true)}>Register a sibling or twin</button>
          <button type="button" className="btn" onClick={() => registerAnother(false)}>Register another child</button>
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
            <fieldset className="field reg-radios">
              <legend>Sex</legend>
              <div className="reg-radio-row">
                {[['female', 'Girl'], ['male', 'Boy']].map(([v, label]) => (
                  <label key={v} className={`reg-radio${sex === v ? ' checked' : ''}`}>
                    <input type="radio" name="sex" value={v} checked={sex === v} onChange={() => setSex(v)} required />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
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
                aria-describedby="reg-dob-age"
              />
              <span id="reg-dob-age" className="reg-age" aria-live="polite">{dob ? ageFrom(dob) : '\u00a0'}</span>
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
                readOnly={Boolean(linkedParent)}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="reg-caregiver">Full name</label>
              <input
                id="reg-caregiver"
                className="input"
                value={caregiverName}
                onChange={(e) => setCaregiverName(e.target.value)}
                required
                readOnly={Boolean(linkedParent)}
                autoComplete="off"
              />
            </div>
          </div>

          {linkedParent ? (
            <div className="reg-family linked">
              <div>
                <strong>Same family as {linkedParent.children.map((k) => k.fullName.split(' ')[0]).join(', ')}.</strong>{' '}
                This child will be added to {linkedParent.fullName}’s record, with reminders to the same number.
              </div>
              <button type="button" className="btn btn-sm" onClick={unlinkParent}>Not the same parent</button>
            </div>
          ) : knownParents.length > 0 && dismissedPhone !== caregiverPhone ? (
            <div className="reg-family" role="status">
              <div className="reg-family-title">This number is already registered</div>
              {knownParents.map((p) => (
                <div key={p._id} className="reg-family-row">
                  <div>
                    <strong>{p.fullName}</strong>, parent of{' '}
                    {p.children.map((k) => `${k.fullName} (${ageFrom(k.dateOfBirth.slice(0, 10)).replace(' old', '')})`).join(', ')}
                  </div>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => linkParent(p)}>Same parent</button>
                </div>
              ))}
              <button type="button" className="reg-linkbtn" onClick={() => setDismissedPhone(caregiverPhone)}>
                Someone else uses this phone
              </button>
            </div>
          ) : (
            <p className="muted reg-hint">Vaccine reminders go to this number by SMS, and it works for USSD on a basic phone.</p>
          )}
        </fieldset>

        <fieldset className="reg-section">
          <legend>Registration</legend>
          <div className="reg-row">
            <div className="field">
              <label htmlFor="reg-facility">Home clinic</label>
              <select
                id="reg-facility"
                className="input"
                value={facilityId}
                onChange={(e) => { setFacilityId(e.target.value); if (e.target.value) saveFacility(e.target.value); }}
                required
              >
                {facilities.length === 0 ? (
                  <option value="">{facilitiesError ? 'Could not load clinics' : 'Loading clinics…'}</option>
                ) : (
                  !facilityId && <option value="">Choose the clinic</option>
                )}
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

        {facilitiesError && (
          <div className="banner error" role="alert">
            The clinic list didn’t load, so the child can’t be registered yet.{' '}
            <button type="button" className="reg-linkbtn" onClick={() => setFacilitiesAttempt((a) => a + 1)}>Try again</button>
          </div>
        )}

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

        <button type="submit" className="btn btn-primary reg-submit" disabled={busy || facilities.length === 0}>
          {busy ? 'Registering…' : 'Register and create card'}
        </button>
      </form>
    </div>
  );
}
