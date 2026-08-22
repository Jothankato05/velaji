import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { StatusPill } from '../components/ui';
import './Forms.css';

interface LookupResult {
  headline: 'CURRENT' | 'ATTENTION REQUIRED';
  status: string;
  method: string;
  tier: string;
  record: Record<string, any>;
}

export function Terminal() {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setError('');
    setBusy(true);
    setResult(null);
    // A scanned QR is a URL; a typed value is a CHIN.
    const body = /^https?:\/\//i.test(v) ? { qr: v } : { chin: v.toUpperCase() };
    try {
      setResult(await api.post<LookupResult>('/api/terminal/lookup', body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  }

  const r = result?.record;

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Verify anywhere · NCIHAP §16</div>
        <h1>Verification terminal</h1>
        <p className="muted page-sub">
          Scan a card's QR or type the CHIN. You'll see only what your role is authorised to view,
          and the access is recorded.
        </p>
      </div>

      <section className="card panel term-panel">
        <form className="lookup-form" onSubmit={onSubmit}>
          <input
            className="input mono"
            placeholder="Scan QR or type NG-YY-MM-XXXXXXXX"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <button className="btn btn-primary" disabled={busy || !value.trim()}>Verify</button>
        </form>

        {error && <div className="banner error">{error}</div>}

        {result && r && (
          <div className="term-result">
            <div className={`term-headline ${result.headline === 'CURRENT' ? 'ok' : 'attn'}`}>
              <span className="term-headline-label">Immunisation status</span>
              <span className="term-headline-value">
                {result.headline} <StatusPill status={result.status} />
              </span>
            </div>

            <dl className="term-fields">
              <div><dt>Child</dt><dd>{r.childName}</dd></div>
              <div><dt>CHIN</dt><dd className="mono">{r.chin}</dd></div>
              {r.nextDue && (
                <div><dt>Next due</dt><dd>{r.nextDue.vaccine} — {String(r.nextDue.dueDate).slice(0, 10)}</dd></div>
              )}
              {r.dateOfBirth && <div><dt>Date of birth</dt><dd>{String(r.dateOfBirth).slice(0, 10)}</dd></div>}
              {r.currentFacility && <div><dt>Facility</dt><dd>{r.currentFacility}</dd></div>}
              {r.caregiver && (
                <div><dt>Guardian</dt><dd>{r.caregiver.fullName}{r.caregiver.phone ? ` · ${r.caregiver.phone}` : ''}</dd></div>
              )}
            </dl>

            <div className="term-tier eyebrow">
              disclosure tier: {result.tier} · via {result.method}
              {result.tier === 'verifier' && ' · full record withheld (least-privilege)'}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
