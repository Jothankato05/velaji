import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Route, Routes, useNavigate, useOutletContext, Outlet } from 'react-router-dom';
import './mychild.css';

interface Milestone { name: string; total: number; administered: number; done: boolean; completedAt: string | null; vaccines: string[]; }
interface Dose { vaccine: string; doseNumber: number; band: string; state: 'done' | 'green' | 'amber' | 'red' | 'closed'; administeredDate: string | null; dueDate: string; }
interface Family {
  chin: string;
  firstName: string;
  fullName: string;
  parentName: string | null;
  age: string;
  status: string;
  reassurance: string;
  progress: { administered: number; total: number; pct: number };
  milestones: Milestone[];
  doses: Dose[];
  facility: { name: string; ward: string; lga: string; state: string } | null;
  nextAppointment: { vaccines: string[]; date: string; dueInDays: number; facility: string } | null;
  coverage: { programme: string; months: number; expiresAt: string; active: boolean } | null;
  rewards: MilestoneReward[];
  nextReward: { key: string; reward: string; dosesToGo: number } | null;
  healthRecords: HealthRecordEntry[];
  tip: string;
}
interface MilestoneReward { key: string; title: string; reward: string; blurb: string; total: number; administered: number; attained: boolean; attainedAt: string | null; missed?: boolean; }
interface HealthRecordEntry { id: string; domain: string; domainLabel: string; title: string; value: string; note: string; facility: string | null; recordedAt: string; }


type Card = { chin: string; token: string };
// Remembered on the device, so a parent doesn't have to rescan the card every
// time the browser is closed. Storage can be unavailable (private mode), so
// every access is guarded and the app still works for the visit.
const CARD_KEY = 'velaji.mychild.card';

function readCard(): Card | null {
  try {
    const c = JSON.parse(localStorage.getItem(CARD_KEY) ?? 'null');
    return c?.chin && c?.token ? { chin: c.chin, token: c.token } : null;
  } catch {
    return null;
  }
}

function saveCard(c: Card | null) {
  try {
    if (c) localStorage.setItem(CARD_KEY, JSON.stringify(c));
    else localStorage.removeItem(CARD_KEY);
  } catch {
    // Not remembered on this device; the card still works for this visit.
  }
}

function parseCard(input: string): Card | null {
  const v = input.trim();
  try {
    const url = new URL(v, window.location.origin);
    const chin = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    const token = url.searchParams.get('t') ?? '';
    if (/^NG-\d{2}-\d{2}-\d{8}$/i.test(chin) && token) return { chin: chin.toUpperCase(), token };
  } catch {
    // maybe "CHIN t=TOKEN" or "CHIN,TOKEN"
  }
  const m = v.match(/(NG-\d{2}-\d{2}-\d{8})[\s,]+t?=?\s*([A-Za-z0-9_-]+)/i);
  if (m) return { chin: m[1].toUpperCase(), token: m[2] };
  return null;
}

// A printed card's QR resolves to /mychild/<CHIN>?t=<token>. If someone lands
// there, consume it into the session and drop them on Home — so scanning the
// card just opens the app, no typing.
function cardFromUrl(): Card | null {
  const path = window.location.pathname;
  const m = path.match(/\/mychild\/(NG-\d{2}-\d{2}-\d{8})$/i);
  const token = new URLSearchParams(window.location.search).get('t');
  if (m && token) return { chin: m[1].toUpperCase(), token };
  return null;
}

export function MyChildApp() {
  // A scanned card wins over a remembered one: a parent with two children
  // switches by scanning the other child's card.
  const [card, setCard] = useState<Card | null>(() => cardFromUrl() ?? readCard());
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fromUrl = cardFromUrl();
    if (fromUrl) {
      saveCard(fromUrl);
      setCard(fromUrl);
      navigate('/mychild', { replace: true });
    }
  }, [navigate]);

  function signOut(message = '') {
    saveCard(null);
    setCard(null);
    setNotice(message);
    navigate('/mychild');
  }

  if (!card) return <SignIn notice={notice} onCard={(c) => { saveCard(c); setCard(c); setNotice(''); navigate('/mychild'); }} />;

  return (
    <Routes>
      <Route
        element={<Shell card={card} onSignOut={signOut} />}
      >
        <Route index element={<HomeView />} />
        <Route path="vaccines" element={<VaccinesView />} />
        <Route path="appointments" element={<AppointmentsView />} />
        <Route path="doctor" element={<DoctorView />} />
        <Route path="emergency" element={<EmergencyView />} />
        <Route path="more" element={<MoreView />} />
      </Route>
    </Routes>
  );
}

function SignIn({ onCard, notice }: { onCard: (c: Card) => void; notice: string }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseCard(value);
    if (!parsed) { setError('Scan the QR on your child’s card, or paste the card link.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/family/${encodeURIComponent(parsed.chin)}?t=${encodeURIComponent(parsed.token)}`);
      if (!res.ok) throw new Error();
      onCard(parsed);
    } catch {
      setError('That card could not be verified. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mc-signin">
      <div className="mc-signin-panel">
        <div className="mc-logo"><span className="mc-heart" aria-hidden>♥</span> MyChild</div>
        <p className="mc-signin-sub">powered by Velaji</p>
        <h1>Your child’s vaccines and next visit</h1>
        <p className="mc-signin-desc">
          Point your phone’s camera at the QR code on your child’s card and open the link. Or paste the card link here.
        </p>
        {notice && <div className="mc-error">{notice}</div>}
        <form onSubmit={submit} className="mc-signin-form">
          <input className="mc-input" placeholder="Paste the card link" aria-label="Card link" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          {error && <div className="mc-error">{error}</div>}
          <button type="submit" className="mc-btn mc-btn-primary" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Open MyChild'}</button>
        </form>
      </div>
    </div>
  );
}

// `tab` is the short label for the bottom bar on phones, where Emergency
// instead gets its own always-visible button at the top.
const NAV: Array<{ to: string; label: string; tab?: string; end?: boolean }> = [
  { to: '/mychild', label: 'Home', tab: 'Home', end: true },
  { to: '/mychild/vaccines', label: 'Vaccines', tab: 'Vaccines' },
  { to: '/mychild/appointments', label: 'Next visit', tab: 'Visit' },
  { to: '/mychild/doctor', label: 'Questions', tab: 'Questions' },
  { to: '/mychild/emergency', label: 'Emergency' },
  { to: '/mychild/more', label: 'Card and account', tab: 'More' }
];

type Ctx = { data: Family; listen: () => void };

function Shell({ card, onSignOut }: { card: Card; onSignOut: (message?: string) => void }) {
  const [data, setData] = useState<Family | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is only a retry trigger
  useEffect(() => {
    setError('');
    fetch(`/api/family/${encodeURIComponent(card.chin)}?t=${encodeURIComponent(card.token)}`)
      .then(async (r) => {
        // A card the server no longer accepts: back to the scan screen, saying why.
        if (r.status === 401 || r.status === 404) {
          onSignOut('That card link no longer works. Scan the card again, or ask your clinic to reprint it.');
          return;
        }
        if (!r.ok) throw new Error();
        setData(await r.json());
      })
      .catch(() => setError('Could not load your child’s record. Check your connection and try again.'));
  }, [card, attempt]);

  function listen() {
    if (!data) return;
    try {
      const u = new SpeechSynthesisUtterance(`${data.firstName} ${data.reassurance}`);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }

  return (
    <div className="mc">
      <aside className="mc-side">
        <div className="mc-logo"><span className="mc-heart" aria-hidden>♥</span> MyChild</div>
        <div className="mc-logo-sub">powered by Velaji</div>
        <nav className="mc-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `mc-nav-link${isActive ? ' active' : ''}`}>{n.label}</NavLink>
          ))}
        </nav>
        <button type="button" className="mc-emergency" onClick={() => onSignOut()}>Sign out</button>
      </aside>

      {/* Phones: a slim top bar with Emergency always one tap away, and the
          sections in a bottom tab bar instead of a menu filling the screen. */}
      <header className="mc-phonebar">
        <div className="mc-logo"><span className="mc-heart" aria-hidden>♥</span> MyChild</div>
        <NavLink to="/mychild/emergency" className="mc-phonebar-sos">Emergency</NavLink>
      </header>
      <nav className="mc-tabbar" aria-label="Sections">
        {NAV.filter((n) => n.tab).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `mc-tab${isActive ? ' active' : ''}`}>{n.tab}</NavLink>
        ))}
      </nav>

      <main className="mc-main">
        {error && (
          <div className="mc-error">
            {error} <button type="button" className="mc-retry" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </div>
        )}
        {!data ? (
          <div className="mc-loading">Loading your child’s record…</div>
        ) : (
          <>
            <div className="mc-top">
              <span className="mc-date">{new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <div className="mc-top-right">
                {data.parentName && (
                  <span className="mc-parent">
                    <span className="mc-parent-av">{data.parentName.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                    <span className="mc-parent-meta"><b>{data.parentName}</b><span>Parent account</span></span>
                  </span>
                )}
              </div>
            </div>
            <Outlet context={{ data, listen } satisfies Ctx} />
          </>
        )}
      </main>
    </div>
  );
}

function useFamily() { return useOutletContext<Ctx>(); }

function ChildChip({ data }: { data: Family }) {
  return (
    <div className="mc-child-chip">
      <span className="mc-child-av">{data.firstName[0]}</span>
      <span className="mc-child-meta"><b>{data.fullName}</b><span>{data.age} · CHIN …{data.chin.slice(-4)}</span></span>
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

function HomeView() {
  const { data, listen } = useFamily();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <p className="mc-greet">{greet}{data.parentName ? `, ${data.parentName.split(' ')[0]}` : ''}</p>
      <h1 className="mc-hello">Overview</h1>
      <ChildChip data={data} />

      <section className={`mc-hero ${data.status}`}>
        <div className="mc-hero-left">
          <span className={`mc-pill ${data.status}`}>{heroTag(data.status)}</span>
          <h2 className="mc-hero-title">{data.firstName} {data.reassurance}</h2>
          <button type="button" className="mc-listen" onClick={listen}>Read aloud</button>
        </div>
        {data.nextAppointment && (
          <div className="mc-appt">
            <div className="mc-appt-label">Next vaccine appointment</div>
            <div className="mc-appt-date">
              <span className="mc-appt-day">{new Date(data.nextAppointment.date).getDate()}</span>
              <span className="mc-appt-mon">{new Date(data.nextAppointment.date).toLocaleDateString('en-NG', { month: 'short' }).toUpperCase()}</span>
            </div>
            <div className="mc-appt-when">{whenLabel(data.nextAppointment.dueInDays)}</div>
            <div className="mc-appt-place">◎ {data.nextAppointment.facility}</div>
          </div>
        )}
      </section>

      <div className="mc-actions">
        {[
          { title: 'Vaccines', sub: 'Every dose, given and due', to: '/mychild/vaccines' },
          { title: 'Next visit', sub: 'When and where to go', to: '/mychild/appointments' },
          { title: 'Questions', sub: 'Answers from health workers', to: '/mychild/doctor' },
          { title: 'Emergency', sub: 'Danger signs and 112', to: '/mychild/emergency' }
        ].map((a) => (
          <NavLink key={a.title} to={a.to} className="mc-action">
            <span className="mc-action-title">{a.title}</span>
            <span className="mc-action-sub">{a.sub}</span>
          </NavLink>
        ))}
      </div>

      <section className="mc-card mc-journey">
        <div className="mc-journey-head">
          <h3>Vaccine journey</h3>
          <span className="mc-journey-pct">{data.progress.pct}% complete</span>
        </div>
        <div className="mc-progress"><span style={{ width: `${data.progress.pct}%` }} /></div>
        <div className="mc-journey-count">{data.progress.administered} of {data.progress.total} doses complete</div>
        <ul className="mc-milestones">
          {data.milestones.map((m) => (
            <li key={m.name} className={`mc-ms${m.done ? ' done' : ''}`}>
              <span className="mc-ms-mark" aria-hidden>{m.done ? '✓' : m.administered > 0 ? '◐' : '○'}</span>
              <span className="mc-ms-body">
                <span className="mc-ms-name">{m.name}</span>
                <span className="mc-ms-sub">{m.done ? `Completed${m.completedAt ? ` ${fmtDate(m.completedAt)}` : ''}` : `${m.administered} of ${m.total} done`}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mc-card mc-rewards">
        <div className="mc-rewards-head">
          <h3>Rewards along the way</h3>
          {data.nextReward && (
            <span className="mc-next-reward">Next: {data.nextReward.reward} · {data.nextReward.dosesToGo} more vaccine{data.nextReward.dosesToGo === 1 ? '' : 's'}</span>
          )}
        </div>
        <div className="mc-reward-grid">
          {data.rewards.map((r) => {
            const isNext = data.nextReward?.key === r.key;
            const cls = r.attained ? 'earned' : isNext ? 'active' : r.missed ? 'locked missed' : 'locked';
            return (
              <div key={r.key} className={`mc-reward ${cls}`}>
                <span className="mc-reward-badge" aria-hidden>{r.attained ? '★' : isNext ? '◔' : '○'}</span>
                <span className="mc-reward-title">{r.title}</span>
                <span className="mc-reward-what">{r.reward}</span>
                <span className="mc-reward-state">
                  {r.attained
                    ? `Earned${r.attainedAt ? ` ${fmtDate(r.attainedAt)}` : ''}`
                    : r.missed
                      ? 'These were for newborns, so this one has passed.'
                      : `${r.administered} of ${r.total} done${isNext ? ` · ${r.total - r.administered} to go` : ''}`}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {data.coverage && (
        <section className="mc-card mc-coverage">
          <span className="mc-cov-badge" aria-hidden>◈</span>
          <div>
            <h3>Healthy Start coverage is active</h3>
            <p>{data.coverage.months} months of NHIA child health coverage, valid through {fmtDate(data.coverage.expiresAt)}.</p>
          </div>
        </section>
      )}

      <section className="mc-card mc-wallet">
        <div className="mc-wallet-head">
          <h3>{data.firstName}’s health record</h3>
          <span className="mc-wallet-sub">One account, growing beyond vaccines</span>
        </div>
        {data.healthRecords.length === 0 ? (
          <p className="mc-wallet-empty">Growth, Vitamin A, nutrition and other checks a health worker records will appear here alongside {data.firstName}’s vaccines.</p>
        ) : (
          <ul className="mc-wallet-list">
            {data.healthRecords.map((r) => (
              <li key={r.id} className="mc-wallet-item">
                <span className="mc-wallet-body">
                  <span className="mc-wallet-title">{r.title} <span className="mc-wallet-domain">{r.domainLabel}</span></span>
                  <span className="mc-wallet-value">{r.value}{r.note ? `: ${r.note}` : ''}</span>
                  <span className="mc-wallet-meta">{fmtDate(r.recordedAt)}{r.facility ? ` · ${r.facility}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mc-card mc-tip">
        <div>
          <div className="mc-tip-label">Health tip</div>
          <div className="mc-tip-body">{data.tip}</div>
        </div>
      </section>
    </>
  );
}

function ViewHead({ data, title, sub }: { data: Family; title: string; sub: string }) {
  return (
    <div className="mc-viewhead">
      <div>
        <h1 className="mc-view-title">{title}</h1>
        <p className="mc-view-sub">{sub}</p>
      </div>
      <ChildChip data={data} />
    </div>
  );
}

const BAND_ORDER = ['Birth vaccines', '6–14 week vaccines', '9-month vaccines', '15-month vaccines'];
const doseStateLabel: Record<Dose['state'], string> = { done: 'Given', green: 'Scheduled', amber: 'Due soon', red: 'Overdue', closed: 'Not needed now' };

function VaccinesView() {
  const { data } = useFamily();
  const bands = [...new Set(data.doses.map((d) => d.band))].sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));

  return (
    <>
      <ViewHead data={data} title={`${data.firstName}’s vaccines`} sub="Every dose in the national schedule: what’s done and what’s coming." />
      <section className="mc-card">
        <div className="mc-journey-head">
          <h3>{data.progress.administered} of {data.progress.total} doses complete</h3>
          <span className="mc-journey-pct">{data.progress.pct}%</span>
        </div>
        <div className="mc-progress"><span style={{ width: `${data.progress.pct}%` }} /></div>
      </section>

      {bands.map((band) => (
        <section key={band} className="mc-card">
          <h3 className="mc-band-title">{band}</h3>
          <ul className="mc-doselist">
            {data.doses.filter((d) => d.band === band).map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: vaccine+dose is already unique; the index only guards against duplicate server rows
              <li key={`${d.vaccine}-${d.doseNumber}-${i}`} className="mc-dose">
                <span className={`mc-dose-dot ${d.state}`} aria-hidden>{d.state === 'done' ? '✓' : ''}</span>
                <span className="mc-dose-body">
                  <span className="mc-dose-name">{d.vaccine}{d.doseNumber > 1 ? ` · dose ${d.doseNumber}` : ''}</span>
                  <span className="mc-dose-when">
                    {d.state === 'done'
                      ? `Given ${d.administeredDate ? fmtDate(d.administeredDate) : ''}`
                      : d.state === 'closed'
                        ? 'Only given to young babies. Nothing to do.'
                        : `Due ${fmtDate(d.dueDate)}`}
                  </span>
                </span>
                <span className={`mc-dose-tag ${d.state}`}>{doseStateLabel[d.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function AppointmentsView() {
  const { data } = useFamily();
  const next = data.nextAppointment;
  return (
    <>
      <ViewHead data={data} title="Next visit" sub="When the next vaccines are due and where to go." />
      {next ? (
        <section className="mc-card mc-appt-card">
          <div className="mc-appt-big">
            <span className="mc-appt-big-day">{new Date(next.date).getDate()}</span>
            <span className="mc-appt-big-mon">{new Date(next.date).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}</span>
            <span className={`mc-appt-big-when${next.dueInDays < 0 ? ' overdue' : ''}`}>{whenLabel(next.dueInDays)}</span>
          </div>
          <div className="mc-appt-detail">
            <div className="mc-appt-detail-label">Vaccines due</div>
            <ul className="mc-appt-vax">{next.vaccines.map((v) => <li key={v}>{v}</li>)}</ul>
            <div className="mc-appt-detail-place">◎ {next.facility}</div>
          </div>
        </section>
      ) : (
        <section className="mc-card mc-coverage">
          <span className="mc-cov-badge" aria-hidden>✓</span>
          <div><h3>All caught up</h3><p>{data.firstName} has completed the routine schedule. There’s nothing to book right now.</p></div>
        </section>
      )}
      <section className="mc-card mc-note">
        <div className="mc-rem-head">How reminders work</div>
        <p>When a dose is due, Velaji sends a reminder to {data.parentName ? `${data.parentName.split(' ')[0]}’s` : 'your'} phone. Bring the card to {next?.facility ?? 'any health centre'}; any health centre in Nigeria can give the next dose. Can’t make that day? Go when you can: the schedule catches up.</p>
      </section>
    </>
  );
}

const FAQ = [
  { q: 'My child has a fever after a vaccine.', a: 'Mild fever for a day or two is normal and shows the vaccine is working. Offer fluids, keep them cool, and give paracetamol if a health worker advised it. See a health worker if the fever is high or lasts more than 48 hours.' },
  { q: 'We missed a scheduled dose.', a: 'It’s not too late. Bring the card to any facility and the schedule catches up automatically, and no earlier dose is wasted.' },
  { q: 'Is it safe to give several vaccines at once?', a: 'Yes. The routine schedule is designed to give several vaccines in one visit safely, so your child is protected sooner with fewer trips.' }
];

function DoctorView() {
  const { data } = useFamily();
  return (
    <>
      <ViewHead data={data} title="Questions" sub="Answers health workers give most often, and where to go for more." />
      {data.facility && (
        <section className="mc-card mc-facility">
          <div>
            <h3>{data.facility.name}</h3>
            <p>{data.facility.ward} ward · {data.facility.lga} LGA · {data.facility.state}</p>
            <p className="mc-facility-note">This is {data.firstName}’s home facility. Bring the card here, or to any facility in Nigeria, for a dose or advice.</p>
          </div>
        </section>
      )}
      <section className="mc-card">
        <h3 className="mc-band-title">Before your visit</h3>
        <ul className="mc-faq">
          {FAQ.map((f) => (
            <li key={f.q} className="mc-faq-item">
              <div className="mc-faq-q">{f.q}</div>
              <div className="mc-faq-a">{f.a}</div>
            </li>
          ))}
        </ul>
      </section>
      <section className="mc-card mc-note">
        <div className="mc-rem-head">Not sure if it’s urgent?</div>
        <p>If {data.firstName} is very unwell, don’t wait for an appointment. See the <NavLink to="/mychild/emergency" className="mc-inline-link">emergency guidance</NavLink> or go to the nearest facility now.</p>
      </section>
    </>
  );
}

const DANGER_SIGNS = [
  'Not able to feed or drink, or vomiting everything',
  'Convulsions or fits',
  'Unusually sleepy, floppy, or hard to wake',
  'Fast or difficult breathing',
  'A very high fever that will not come down'
];

function EmergencyView() {
  const { data } = useFamily();
  return (
    <>
      <ViewHead data={data} title="Emergency" sub="If your child shows any danger sign, get help now. Don’t wait." />
      <section className="mc-card mc-emergency-call">
        <div>
          <div className="mc-rem-head">National emergency line</div>
          <div className="mc-emergency-num">112</div>
          <p>Free, 24 hours, from any phone in Nigeria.</p>
        </div>
        <a href="tel:112" className="mc-btn mc-btn-primary mc-call-btn">Call 112</a>
      </section>

      <section className="mc-card">
        <h3 className="mc-band-title">Go to a facility straight away if {data.firstName} has:</h3>
        <ul className="mc-danger">
          {DANGER_SIGNS.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </section>

      {data.facility && (
        <section className="mc-card mc-facility">
          <div>
            <h3>Nearest known facility</h3>
            <p>{data.facility.name}, {data.facility.ward}, {data.facility.lga}, {data.facility.state}</p>
          </div>
        </section>
      )}
    </>
  );
}

function MoreView() {
  const { data } = useFamily();
  return (
    <>
      <ViewHead data={data} title="Card and account" sub="Your child’s details, cover and the card." />
      <section className="mc-card">
        <h3 className="mc-band-title">Child</h3>
        <dl className="mc-kv">
          <div><dt>Name</dt><dd>{data.fullName}</dd></div>
          <div><dt>Age</dt><dd>{data.age}</dd></div>
          <div><dt>Health ID (CHIN)</dt><dd>{data.chin}</dd></div>
          {data.parentName && <div><dt>Parent / caregiver</dt><dd>{data.parentName}</dd></div>}
          {data.facility && <div><dt>Home facility</dt><dd>{data.facility.name}</dd></div>}
        </dl>
      </section>
      {data.coverage && (
        <section className="mc-card mc-coverage">
          <span className="mc-cov-badge" aria-hidden>◈</span>
          <div>
            <h3>Healthy Start: {data.coverage.active ? 'active' : 'expired'}</h3>
            <p>{data.coverage.months} months of NHIA child health coverage{data.coverage.active ? ` through ${fmtDate(data.coverage.expiresAt)}` : ''}.</p>
          </div>
        </section>
      )}
      <section className="mc-card mc-note">
        <div className="mc-rem-head">Another child?</div>
        <p>Scan that child’s card with your phone camera and MyChild switches to them.</p>
      </section>
      <section className="mc-card mc-note">
        <div className="mc-rem-head">Keep the card safe</div>
        <p>The card is the key. It works at any health facility in Nigeria. You never have to remember which vaccine is next or when. If you lose it, visit your home facility to reprint it.</p>
      </section>
    </>
  );
}

/** "today", "in 3 days", "12 days overdue". */
function whenLabel(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${-days} day${days === -1 ? '' : 's'} overdue`;
}

function heroTag(status: string): string {
  return status === 'GREEN' ? 'On track' : status === 'BLUE' ? 'Fully protected' : status === 'AMBER' ? 'Vaccine due soon' : status === 'RED' ? 'Action needed' : 'Needs review';
}
