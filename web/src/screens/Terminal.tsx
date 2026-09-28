import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { StatusPill } from '../components/ui';
import './Forms.css';

interface LookupResult {
  headline: 'CURRENT' | 'ATTENTION REQUIRED';
  status: string;
  method: 'chin' | 'qr';
  tier: string;
  record: TerminalRecord;
}

// What the terminal renders. A verifier gets only the base fields; the
// optional ones arrive for staff and admin (least-privilege, NCIHAP §24).
interface TerminalRecord {
  chin: string;
  childName: string;
  nextDue: { vaccine: string; dueDate: string } | null;
  sex?: string;
  dateOfBirth?: string;
  currentFacility?: string | null;
  caregiver?: { fullName: string; phone: string | null } | null;
}

const DAY = 86400000;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function relative(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / DAY);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** One line saying why the child is up to date or needs attention. */
function reason(status: string, next: TerminalRecord['nextDue']): string {
  if (status === 'BLUE') return 'Every scheduled vaccine has been given.';
  if (status === 'GREY') return 'The record needs checking by a health worker.';
  if (!next) return '';
  if (status === 'RED') return `Has missed a vaccine: ${next.vaccine} was due ${fmtDate(next.dueDate)} (${relative(next.dueDate)}).`;
  if (status === 'AMBER') return `${next.vaccine} is due ${relative(next.dueDate)}, on ${fmtDate(next.dueDate)}.`;
  return `Next vaccine: ${next.vaccine} on ${fmtDate(next.dueDate)} (${relative(next.dueDate)}).`;
}

function ageLabel(dob: string): string {
  const days = Math.floor((Date.now() - new Date(dob).getTime()) / DAY);
  if (days < 60) return `${days} days old`;
  const months = Math.floor(days / 30.44);
  return months < 24 ? `${months} months old` : `${Math.floor(months / 12)} years old`;
}

export function Terminal() {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();

  // A CHIN handed in from the top-bar search is checked straight away, including
  // when this screen is already open (a verifier's home), so it follows the param.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the param only, then clears it
  useEffect(() => {
    const chin = params.get('chin');
    if (chin) {
      setValue(chin);
      void check(chin);
      setParams({}, { replace: true });
    }
  }, [params]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void check(value);
  }

  async function check(raw: string) {
    const v = raw.trim();
    if (!v) return;
    setError('');
    setBusy(true);
    setResult(null);
    // A scanned QR is a URL; a typed value is a CHIN.
    const body = /^https?:\/\//i.test(v) ? { qr: v } : { chin: v.toUpperCase() };
    try {
      setResult(await api.post<LookupResult>('/api/terminal/lookup', body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check this card. Try again.');
    } finally {
      setBusy(false);
      // Ready for the next card: a scan or typing replaces what's there.
      requestAnimationFrame(() => input.current?.select());
    }
  }

  const r = result?.record;
  const ok = result?.headline === 'CURRENT';
  const canCare = user?.role === 'staff' || user?.role === 'admin';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Verify a card</h1>
        <p className="muted page-sub">
          Scan the card's QR code or type the CHIN to check a child's immunisation status. Each check is recorded.
        </p>
      </div>

      <section className="card panel term-panel">
        <form className="lookup-form" onSubmit={onSubmit}>
          <input
            ref={input}
            className="input"
            placeholder="Scan the QR code or type the CHIN"
            aria-label="QR code or CHIN"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </form>

        {error && <div className="banner error" role="alert">{error}</div>}

        {result && r && (
          <div className="term-result">
            <div className={`term-headline ${ok ? 'ok' : 'attn'}`} role="status">
              <div className="term-headline-value">
                {ok ? 'Up to date' : 'Needs attention'}
                <StatusPill status={result.status} />
              </div>
              <div className="term-reason">{reason(result.status, r.nextDue)}</div>
            </div>

            <dl className="term-fields">
              <div><dt>Child</dt><dd>{r.childName}</dd></div>
              <div><dt>CHIN</dt><dd className="term-chin">{r.chin}</dd></div>
              {r.dateOfBirth && (
                <div>
                  <dt>Age</dt>
                  <dd>{ageLabel(r.dateOfBirth)} <span className="muted">(born {fmtDate(r.dateOfBirth)})</span></dd>
                </div>
              )}
              {r.currentFacility && <div><dt>Home clinic</dt><dd>{r.currentFacility}</dd></div>}
              {r.caregiver && (
                <div>
                  <dt>Parent or guardian</dt>
                  <dd>
                    {r.caregiver.fullName}
                    {r.caregiver.phone && <> · <a href={`tel:${r.caregiver.phone}`}>{r.caregiver.phone}</a></>}
                  </dd>
                </div>
              )}
            </dl>

            {canCare && (
              <div className="term-actions">
                <Link className="btn" to={`/care?chin=${encodeURIComponent(r.chin)}`}>Open at point of care</Link>
              </div>
            )}

            <p className="muted term-note">
              {result.method === 'qr' ? 'Card QR code verified as genuine.' : 'Looked up by CHIN; scan the QR code to confirm the card itself is genuine.'}{' '}
              {result.tier === 'verifier'
                ? 'Verifiers see the name, status and next vaccine only.'
                : 'Health workers also see age, clinic and parent contact.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
