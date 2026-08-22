import { useEffect, useState, type FormEvent } from 'react';
import './mychild.css';

interface Milestone { name: string; total: number; administered: number; done: boolean; completedAt: string | null; vaccines: string[]; }
interface Family {
  chin: string;
  firstName: string;
  fullName: string;
  age: string;
  status: string;
  reassurance: string;
  progress: { administered: number; total: number; pct: number };
  milestones: Milestone[];
  nextAppointment: { vaccines: string[]; date: string; dueInDays: number; facility: string } | null;
  coverage: { programme: string; months: number; expiresAt: string; active: boolean } | null;
  tip: string;
}

const CARD_KEY = 'ncihap.card'; // { chin, token }

function readCard(): { chin: string; token: string } | null {
  const raw = sessionStorage.getItem(CARD_KEY);
  return raw ? JSON.parse(raw) : null;
}

function parseCard(input: string): { chin: string; token: string } | null {
  const v = input.trim();
  try {
    const url = new URL(v);
    const chin = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    const token = url.searchParams.get('t') ?? '';
    if (chin && token) return { chin, token };
  } catch {
    // maybe "CHIN t=TOKEN" or "CHIN,TOKEN"
    const m = v.match(/(CHN-[0-9A-Z-]+)[\s,]+t?=?\s*([A-Za-z0-9_-]+)/i);
    if (m) return { chin: m[1].toUpperCase(), token: m[2] };
  }
  return null;
}

export function MyChildApp() {
  const [card, setCard] = useState<{ chin: string; token: string } | null>(() => readCard());
  if (!card) return <SignIn onCard={(c) => { sessionStorage.setItem(CARD_KEY, JSON.stringify(c)); setCard(c); }} />;
  return <Home card={card} onSignOut={() => { sessionStorage.removeItem(CARD_KEY); setCard(null); }} />;
}

function SignIn({ onCard }: { onCard: (c: { chin: string; token: string }) => void }) {
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
        <p className="mc-signin-sub">powered by NCIHAP</p>
        <h1>Your child’s health, in your hand.</h1>
        <p className="mc-signin-desc">Scan the QR on your child’s card, or paste the card link, to see their vaccines and next visit.</p>
        <form onSubmit={submit} className="mc-signin-form">
          <input className="mc-input" placeholder="Scan card QR or paste card link" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          {error && <div className="mc-error">{error}</div>}
          <button className="mc-btn mc-btn-primary" disabled={busy || !value.trim()}>{busy ? 'Checking…' : 'Open MyChild'}</button>
        </form>
      </div>
    </div>
  );
}

const NAV = ['Home', 'Vaccines', 'Appointments', 'Doctor', 'More'];

function Home({ card, onSignOut }: { card: { chin: string; token: string }; onSignOut: () => void }) {
  const [data, setData] = useState<Family | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/family/${encodeURIComponent(card.chin)}?t=${encodeURIComponent(card.token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError('Could not load your child’s record.'));
  }, [card]);

  function listen() {
    if (!data) return;
    const msg = `${data.firstName} ${data.reassurance}`;
    try {
      const u = new SpeechSynthesisUtterance(msg);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mc">
      <aside className="mc-side">
        <div className="mc-logo"><span className="mc-heart" aria-hidden>♥</span> MyChild</div>
        <div className="mc-logo-sub">powered by NCIHAP</div>
        <nav className="mc-nav">
          {NAV.map((n, i) => (
            <a key={n} className={`mc-nav-link${i === 0 ? ' active' : ''}`} href="#">{n}</a>
          ))}
        </nav>
        <div className="mc-help">
          <div className="mc-help-title">Need help?</div>
          <div className="mc-help-sub">Talk to a health worker anytime.</div>
          <button className="mc-btn mc-help-btn">Start a chat</button>
        </div>
        <button className="mc-emergency" onClick={onSignOut}>◁ Sign out</button>
      </aside>

      <main className="mc-main">
        {error && <div className="mc-error">{error}</div>}
        {!data ? (
          <div className="mc-loading">Loading your child’s record…</div>
        ) : (
          <>
            <div className="mc-top">
              <span className="mc-date">{new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <span className="mc-lang">◎ English</span>
            </div>

            <p className="mc-greet">{greet} 👋</p>
            <h1 className="mc-hello">Let’s keep {data.firstName} healthy.</h1>

            <section className={`mc-hero ${data.status}`}>
              <div className="mc-hero-left">
                <span className={`mc-pill ${data.status}`}>{heroTag(data.status)}</span>
                <h2 className="mc-hero-title">{data.firstName} {data.reassurance}</h2>
                <button className="mc-listen" onClick={listen}>🔊 Listen</button>
              </div>
              {data.nextAppointment && (
                <div className="mc-appt">
                  <div className="mc-appt-label">Next vaccine appointment</div>
                  <div className="mc-appt-date">
                    <span className="mc-appt-day">{new Date(data.nextAppointment.date).getDate()}</span>
                    <span className="mc-appt-mon">{new Date(data.nextAppointment.date).toLocaleDateString('en-NG', { month: 'short' }).toUpperCase()}</span>
                  </div>
                  <div className="mc-appt-when">{data.nextAppointment.dueInDays >= 0 ? `in ${data.nextAppointment.dueInDays} days` : 'overdue'}</div>
                  <div className="mc-appt-place">◎ {data.nextAppointment.facility}</div>
                </div>
              )}
            </section>

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
                      <span className="mc-ms-sub">{m.done ? `Completed${m.completedAt ? ' ' + new Date(m.completedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}` : `${m.administered} of ${m.total} done`}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {data.coverage && (
              <section className="mc-card mc-coverage">
                <span className="mc-cov-badge" aria-hidden>◈</span>
                <div>
                  <h3>Healthy Start coverage is active</h3>
                  <p>{data.coverage.months} months of NHIA child health coverage — through {new Date(data.coverage.expiresAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
                </div>
              </section>
            )}

            {data.nextAppointment && data.nextAppointment.vaccines.length > 0 && (
              <section className="mc-card mc-reminder">
                <div className="mc-rem-head">Upcoming reminder</div>
                <div className="mc-rem-vax">{data.nextAppointment.vaccines.join(' + ')}</div>
                <div className="mc-rem-when">{data.nextAppointment.dueInDays >= 0 ? `Due in ${data.nextAppointment.dueInDays} days` : 'Overdue'} · {data.nextAppointment.facility}</div>
              </section>
            )}

            <section className="mc-card mc-tip">
              <span className="mc-tip-icon" aria-hidden>☀</span>
              <div>
                <div className="mc-tip-label">Today’s simple health tip</div>
                <div className="mc-tip-body">{data.tip}</div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function heroTag(status: string): string {
  return status === 'GREEN' ? 'On track' : status === 'BLUE' ? 'Fully protected' : status === 'AMBER' ? 'Vaccine due soon' : status === 'RED' ? 'Action needed' : 'Needs review';
}
