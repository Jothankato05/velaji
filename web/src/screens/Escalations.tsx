import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../lib/useGet';
import { api, ApiError } from '../lib/api';
import { Loading, ErrorNote, Empty } from '../components/ui';
import './Forms.css';

interface Escalation {
  id: string;
  chin: string;
  childName: string;
  caregiverName: string | null;
  caregiverPhone: string | null;
  facilityName: string | null;
  vaccine: string;
  reasonLabel: string;
  remindersSent: number;
  daysOverdue: number | null;
  raisedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  outcome: string | null;
  barrierLabel: string | null;
  resolutionNote: string;
}
interface EscalationList {
  status: string;
  count: number;
  escalations: Escalation[];
}

// "Immunized" isn't offered: recording the dose at point of care closes the
// case by itself, and the server refuses the claim while the dose is missing.
const OUTCOMES: Array<[string, string]> = [
  ['reached', 'Reached the family'],
  ['moved_away', 'Family has moved away'],
  ['unreachable', 'Could not reach them'],
  ['other', 'Other (add a note)']
];
const OUTCOME_LABEL: Record<string, string> = {
  immunized: 'Vaccinated',
  reached: 'Reached the family',
  moved_away: 'Moved away',
  unreachable: 'Could not reach',
  other: 'Other'
};
// The documented Nigerian drivers of defaulting, recorded when tracing a case.
const BARRIERS: Array<[string, string]> = [
  ['hesitancy', 'Vaccine hesitancy or refusal'],
  ['distance', 'Distance or access'],
  ['insecurity', 'Insecurity'],
  ['financial', 'Cost or poverty'],
  ['unaware', "Didn't know or forgot"],
  ['no_session', 'No session or stock-out'],
  ['other', 'Other']
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Escalations() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [clinic, setClinic] = useState('');
  const list = useGet<EscalationList>(`/api/escalations?status=${tab}`);
  const [resolving, setResolving] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const all = list.data?.escalations ?? [];
  const clinics = [...new Set(all.map((e) => e.facilityName).filter((n): n is string => Boolean(n)))].sort();
  const rows = clinic ? all.filter((e) => e.facilityName === clinic) : all;

  function switchTab(t: 'open' | 'resolved') {
    setTab(t);
    setResolving(null);
    setNotice('');
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Follow-up queue</h1>
        <p className="muted page-sub">
          Children whose caregivers haven't responded to reminders, or can't be reached, longest overdue first.
          Each needs someone to contact or visit the family.
        </p>
      </div>

      <div className="esc-bar">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'open'} className={`tab${tab === 'open' ? ' active' : ''}`} onClick={() => switchTab('open')}>
            Open{tab === 'open' && list.data ? ` (${list.data.count})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'resolved'} className={`tab${tab === 'resolved' ? ' active' : ''}`} onClick={() => switchTab('resolved')}>
            Resolved{tab === 'resolved' && list.data ? ` (${list.data.count})` : ''}
          </button>
        </div>
        {clinics.length > 1 && (
          <label className="esc-filter">
            <span className="muted">Clinic</span>
            <select className="input" value={clinic} onChange={(e) => setClinic(e.target.value)}>
              <option value="">All clinics</option>
              {clinics.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>

      {notice && <div className="banner ok" role="status">{notice}</div>}

      <section className="card panel">
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorNote message={list.error} />
        ) : rows.length === 0 ? (
          <Empty>
            {tab === 'open'
              ? clinic ? `No open cases at ${clinic}.` : 'Nothing in the queue. Every child is reachable or on track.'
              : 'No resolved cases yet.'}
          </Empty>
        ) : (
          <ul className="esc-list">
            {rows.map((e) => (
              <li key={e.id} className="esc-item">
                <div className="esc-main">
                  <div className="esc-who">
                    <div className="esc-name">{e.childName}</div>
                    <div className="muted esc-sub">{e.chin}{e.facilityName ? ` · ${e.facilityName}` : ''}</div>
                  </div>
                  <div className="esc-what">
                    <div>{e.vaccine}</div>
                    {e.daysOverdue != null && <div className="esc-late">{e.daysOverdue} days overdue</div>}
                  </div>
                  <div className="esc-contact">
                    <div>{e.caregiverName ?? 'No caregiver on record'}</div>
                    {e.caregiverPhone
                      ? <a href={`tel:${e.caregiverPhone}`}>{e.caregiverPhone}</a>
                      : <span className="muted esc-sub">No phone</span>}
                  </div>
                </div>

                {tab === 'open' ? (
                  <>
                    <div className="muted esc-sub esc-why">
                      {e.reasonLabel}{e.remindersSent ? ` · ${e.remindersSent} reminders sent` : ''} · in queue since {fmtDate(e.raisedAt)}
                    </div>
                    {resolving === e.id ? (
                      <ResolveForm
                        escalation={e}
                        onCancel={() => setResolving(null)}
                        onDone={() => {
                          setResolving(null);
                          setNotice(`Closed the case for ${e.childName}.`);
                          list.reload();
                        }}
                      />
                    ) : (
                      <div className="esc-actions">
                        <Link className="btn btn-sm" to={`/care?chin=${encodeURIComponent(e.chin)}`}>Open at point of care</Link>
                        <button type="button" className="btn btn-sm" onClick={() => { setResolving(e.id); setNotice(''); }}>Record outcome</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="esc-result">
                    <strong>{OUTCOME_LABEL[e.outcome ?? 'other'] ?? e.outcome}</strong>
                    {e.barrierLabel && <> · reason: {e.barrierLabel}</>}
                    <span className="muted">
                      {' '}· closed {e.resolvedAt ? fmtDate(e.resolvedAt) : ''}{e.resolvedBy ? ` by ${e.resolvedBy === 'system' ? 'the system when the dose was recorded' : e.resolvedBy}` : ''}
                    </span>
                    {e.resolutionNote && <div className="muted esc-note">“{e.resolutionNote}”</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ResolveForm({ escalation, onCancel, onDone }: { escalation: Escalation; onCancel: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [barrier, setBarrier] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const needsNote = outcome === 'other' && !note.trim();

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/escalations/${escalation.id}/resolve`, { outcome, barrier: barrier || null, note: note.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="esc-form">
      <p className="muted esc-sub">
        Vaccinated? <Link to={`/care?chin=${encodeURIComponent(escalation.chin)}`}>Record the dose at point of care</Link> and this case closes itself.
      </p>
      <fieldset className="esc-outcomes">
        <legend>Outcome</legend>
        {OUTCOMES.map(([v, l]) => (
          <label key={v} className="esc-radio">
            <input type="radio" name={`outcome-${escalation.id}`} value={v} checked={outcome === v} onChange={() => setOutcome(v)} />
            {l}
          </label>
        ))}
      </fieldset>
      <div className="esc-form-row">
        <label className="field">
          <span>Why was the child missed? (optional)</span>
          <select className="input" value={barrier} onChange={(e) => setBarrier(e.target.value)}>
            <option value="">Not known</option>
            {BARRIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Note{outcome === 'other' ? '' : ' (optional)'}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Mother will bring her on Friday" />
        </label>
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
      <div className="esc-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!outcome || needsNote || saving}>
          {saving ? 'Saving…' : 'Save and close case'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
