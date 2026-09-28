import { useState } from 'react';
import './UssdSim.css';

/**
 * A feature-phone USSD simulator (NCIHAP §8 demo). It drives the real
 * /webhooks/ussd endpoint exactly as a telecom gateway would — accumulating the
 * caller's key presses into `text` (joined by *) and rendering the CON/END
 * reply — so the basic-phone experience can be shown without a real handset.
 */
export function UssdSim() {
  const [phone, setPhone] = useState('+2348010000001');
  const [dialCode] = useState('*347#');
  const [text, setText] = useState('');
  const [screen, setScreen] = useState<string>('');
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
        body: JSON.stringify({ phoneNumber: phone, text: nextText })
      });
      const raw = (await res.text()).trim();
      const cont = raw.startsWith('CON');
      setScreen(raw.replace(/^(CON|END)\s?/, ''));
      setOpen(cont);
      setText(nextText);
      setReply('');
    } catch {
      setScreen('Network error. Could not reach the USSD service.');
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
    if (!reply.trim()) return;
    void send(text ? `${text}*${reply.trim()}` : reply.trim());
  }
  function reset() {
    setStarted(false); setOpen(false); setScreen(''); setText(''); setReply('');
  }

  return (
    <div className="ussd">
      <div className="ussd-intro">
        <h1>USSD access</h1>
        <p className="muted">
          A caregiver with no smartphone dials a short code and gets the same critical
          information as the app: child status, the next vaccine and where, and reward
          progress, identified by their phone number with nothing to type. This drives the
          real <code>/webhooks/ussd</code> endpoint.
        </p>
        <p className="muted ussd-hint">
          Try a seeded caregiver number (the demo server prints one as <code>USSD_PHONE</code>),
          then dial. Reply with a menu number and press Send.
        </p>
      </div>

      <div className="ussd-phone">
        <div className="ussd-screen">
          {!started ? (
            <div className="ussd-idle">
              <div className="ussd-idle-brand">Velaji</div>
              <div className="ussd-idle-sub">Dial {dialCode}</div>
            </div>
          ) : (
            <>
              <div className="ussd-msg">{busy ? 'Please wait…' : screen}</div>
              {open && !busy && (
                <div className="ussd-input-row">
                  <input
                    className="ussd-input"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitReply()}
                    placeholder="Reply"
                    autoFocus
                    inputMode="numeric"
                  />
                  <button type="button" className="ussd-key" onClick={submitReply}>Send</button>
                </div>
              )}
              {!open && !busy && <div className="ussd-ended">Session ended</div>}
            </>
          )}
        </div>

        <div className="ussd-controls">
          <label className="ussd-field">
            <span>Phone number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={started} />
          </label>
          {!started ? (
            <button type="button" className="btn btn-primary ussd-dial" onClick={dial} disabled={!phone.trim()}>Dial {dialCode}</button>
          ) : (
            <button type="button" className="btn ussd-dial" onClick={reset}>End &amp; start over</button>
          )}
        </div>
      </div>
    </div>
  );
}
