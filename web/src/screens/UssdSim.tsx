import { useState } from 'react';
import './UssdSim.css';

/**
 * A basic-phone USSD simulator (NCIHAP §8). It drives the real /webhooks/ussd
 * endpoint the way a telecom gateway does: each key press is added to `text`
 * (joined by *), and the reply's CON / END says whether the session continues.
 */

const DIAL_CODE = '*347#';
// Numbers from the invented demo data, offered only on the demo instance (the
// same build-time switch that pre-fills the demo login).
const IS_DEMO = Boolean(import.meta.env.VITE_DEMO_USERNAME);
const SAMPLES: Array<{ phone: string; label: string }> = [
  { phone: '+2348010000001', label: 'Parent of a child who is on track' },
  { phone: '+2348030000088', label: 'Parent of an overdue child' },
  { phone: '+2348000000000', label: 'A number with no child registered' }
];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function UssdSim() {
  const [phone, setPhone] = useState(IS_DEMO ? SAMPLES[0].phone : '');
  const [text, setText] = useState('');
  const [screen, setScreen] = useState('');
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(nextText: string) {
    setBusy(true);
    try {
      const res = await fetch('/webhooks/ussd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone.trim(), text: nextText })
      });
      const raw = (await res.text()).trim();
      if (!res.ok) throw new Error(raw);
      setScreen(raw.replace(/^(CON|END)\s?/, ''));
      setOpen(raw.startsWith('CON'));
      setText(nextText);
      setReply('');
    } catch {
      setScreen('Connection problem.\nPlease try again.');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function dial() {
    setStarted(true);
    void send('');
  }
  function submitReply() {
    const r = reply.trim();
    if (!r || busy) return;
    void send(text ? `${text}*${r}` : r);
  }
  function hangUp() {
    setStarted(false);
    setOpen(false);
    setScreen('');
    setText('');
    setReply('');
  }
  function pressKey(k: string) {
    if (!started) {
      setPhone((p) => p + k);
      return;
    }
    if (open && !busy) setReply((r) => r + k);
  }

  return (
    <div className="ussd">
      <div className="ussd-intro">
        <h1>USSD access</h1>
        <p className="muted">
          Parents without a smartphone dial {DIAL_CODE} from any phone. They are recognised by their phone number,
          so there's nothing to type in, and they get the same essentials as the app: the child's status, the next
          vaccine and where to go, and their reward progress.
        </p>
        <p className="muted">This screen works like the phone: dial, then reply with a menu number.</p>

        {IS_DEMO && (
          <div className="ussd-samples">
            <div className="ussd-samples-title">Try a demo number</div>
            {SAMPLES.map((s) => (
              <button
                key={s.phone}
                type="button"
                className={`ussd-sample${phone === s.phone ? ' active' : ''}`}
                onClick={() => { hangUp(); setPhone(s.phone); }}
              >
                <span className="ussd-sample-phone">{s.phone}</span>
                <span className="muted">{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ussd-phone">
        <div className="ussd-screen" aria-live="polite">
          {!started ? (
            <div className="ussd-idle">
              <div className="ussd-idle-brand">Velaji</div>
              <div className="ussd-idle-sub">Dial {DIAL_CODE}</div>
            </div>
          ) : (
            <>
              <div className="ussd-msg">{busy ? 'Please wait…' : screen}</div>
              {open && !busy && (
                <div className="ussd-input-row">
                  <input
                    className="ussd-input"
                    value={reply}
                    onChange={(e) => setReply(e.target.value.replace(/[^0-9*#]/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && submitReply()}
                    placeholder="Reply"
                    aria-label="Reply"
                    autoFocus
                    inputMode="numeric"
                  />
                </div>
              )}
              {!open && !busy && <div className="ussd-ended">Session ended</div>}
            </>
          )}
        </div>

        <label className="ussd-field">
          <span>Calling from</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={started}
            placeholder="Phone number"
          />
        </label>

        <div className="ussd-calls">
          {!started ? (
            <button type="button" className="ussd-call" onClick={dial} disabled={!phone.trim()}>Dial {DIAL_CODE}</button>
          ) : open ? (
            <button type="button" className="ussd-call" onClick={submitReply} disabled={busy || !reply.trim()}>Send</button>
          ) : (
            <button type="button" className="ussd-call" onClick={dial} disabled={busy}>Dial again</button>
          )}
          <button type="button" className="ussd-end" onClick={hangUp} disabled={!started}>End</button>
        </div>

        <div className="ussd-keypad">
          {KEYS.map((k) => (
            <button key={k} type="button" className="ussd-keypad-key" onClick={() => pressKey(k)} disabled={started && (!open || busy)}>
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
