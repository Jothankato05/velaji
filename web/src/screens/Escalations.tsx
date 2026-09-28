import { useState } from 'react';
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
  barrierLabel: string | null;
  daysOverdue: number | null;
}
interface EscalationList {
  status: string;
  count: number;
  escalations: Escalation[];
}

const OUTCOMES = ['reached', 'immunized', 'moved_away', 'unreachable', 'other'];
// The documented Nigerian drivers of defaulting — recorded when tracing a case.
const BARRIERS: Array<[string, string]> = [
  ['hesitancy', 'Vaccine hesitancy / refusal'],
  ['distance', 'Distance / access'],
  ['insecurity', 'Insecurity'],
  ['financial', 'Financial / poverty'],
  ['unaware', 'Unaware / forgot'],
  ['no_session', 'No session / stockout'],
  ['other', 'Other']
];

export function Escalations() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const list = useGet<EscalationList>(`/api/escalations?status=${tab}`);
  const [resolving, setResolving] = useState<string | null>(null);
  const [barrier, setBarrier] = useState('');
  const [err, setErr] = useState('');

  async function resolve(id: string, outcome: string) {
    setErr('');
    try {
      await api.post(`/api/escalations/${id}/resolve`, { outcome, barrier: barrier || null });
      setResolving(null);
      setBarrier('');
      list.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not resolve');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Follow-up queue</h1>
        <p className="muted page-sub">
          Children whose caregivers haven't responded to reminders, or can't be
          reached. These need someone to trace the family.
        </p>
      </div>

      <div className="tabs">
        <button type="button" className={`tab${tab === 'open' ? ' active' : ''}`} onClick={() => setTab('open')}>Open</button>
        <button type="button" className={`tab${tab === 'resolved' ? ' active' : ''}`} onClick={() => setTab('resolved')}>Resolved</button>
      </div>

      {err && <div className="banner error">{err}</div>}

      <section className="card panel">
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorNote message={list.error} />
        ) : !list.data || list.data.escalations.length === 0 ? (
          <Empty>{tab === 'open' ? 'Nothing in the queue. Every child is reachable or on track.' : 'No resolved cases yet.'}</Empty>
        ) : (
          <div className="esc-table">
            <div className="esc-head">
              <span>Child</span><span>Vaccine</span><span>Reason</span><span>Overdue</span><span>Contact</span><span></span>
            </div>
            {list.data.escalations.map((e) => (
              <div key={e.id} className="esc-row">
                <span>
                  <div className="esc-name">{e.childName}</div>
                  <div className="mono muted esc-chin">{e.chin}</div>
                </span>
                <span>{e.vaccine}</span>
                <span className="esc-reason">{tab === 'resolved' && e.barrierLabel ? e.barrierLabel : e.reasonLabel}</span>
                <span className="mono">{e.daysOverdue != null ? `${e.daysOverdue}d` : '-'}</span>
                <span className="esc-contact">
                  {e.caregiverName ?? '-'}
                  {e.caregiverPhone && <div className="mono muted">{e.caregiverPhone}</div>}
                </span>
                <span className="esc-action">
                  {tab === 'open' && (
                    resolving === e.id ? (
                      <span className="esc-resolve">
                        <select className="input esc-outcome" value={barrier} onChange={(ev) => setBarrier(ev.target.value)}>
                          <option value="">Barrier (why)…</option>
                          {BARRIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <select
                          className="input esc-outcome"
                          defaultValue=""
                          onChange={(ev) => ev.target.value && void resolve(e.id, ev.target.value)}
                        >
                          <option value="" disabled>Outcome…</option>
                          {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                        </select>
                      </span>
                    ) : (
                      <button type="button" className="btn" onClick={() => { setResolving(e.id); setBarrier(''); }}>Resolve</button>
                    )
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
