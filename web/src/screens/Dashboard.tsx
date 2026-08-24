import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../lib/useGet';
import { Loading, ErrorNote, Empty, fmt, pct } from '../components/ui';
import './Dashboard.css';

interface Metrics {
  registered: number;
  dosesAdministered: number;
  onTrack: number;
  dueThisWeek: number;
  overdue: number;
  zeroDose: number;
  completed: number;
  dropout: number;
  needsReconciliation: number;
  completionRate: number;
  dropoutRate: number;
}
interface Summary {
  scope: { level: string; state?: string; lga?: string; ward?: string; label: string };
  totals: Metrics;
  breakdownBy: string;
  breakdown: Array<{ key: string; metrics: Metrics }>;
  openEscalations: number;
  healthyStartActive: number;
  generatedAt: string;
}
interface StatePriority {
  state: string;
  registered: number;
  onTrack: number;
  overdue: number;
  dueThisWeek: number;
  completionRate: number;
  overdueRate: number;
  priority: 'red' | 'amber' | 'green';
}
interface Coverage { states: StatePriority[]; }
interface Trend { points: Array<{ weekStarting: string; dosesAdministered: number }>; }
interface Stock { byVaccine: Array<{ vaccineCode: string; dueCount: number }>; }
interface Outliers { outliers: Array<{ facility: string; state: string; lga: string; registered: number; dropoutRate: number }>; }
interface Activity { events: Array<{ kind: string; label: string; detail: string; at: string }>; }

type Filter = { state?: string; lga?: string; ward?: string };

function qs(f: Filter): string {
  const p = new URLSearchParams();
  if (f.state) p.set('state', f.state);
  if (f.lga) p.set('lga', f.lga);
  if (f.ward) p.set('ward', f.ward);
  const s = p.toString();
  return s ? `?${s}` : '';
}
const LEVEL_LABEL: Record<string, string> = { state: 'States', lga: 'LGAs', ward: 'Wards', facility: 'Facilities (PHC)' };
const PRIORITY_LABEL: Record<string, string> = { red: 'Priority', amber: 'Watch', green: 'On track' };

export function Dashboard() {
  const [filter, setFilter] = useState<Filter>({});
  const summary = useGet<Summary>(`/api/dashboard/summary${qs(filter)}`);
  const trend = useGet<Trend>('/api/dashboard/trend?weeks=8');
  const stock = useGet<Stock>(`/api/dashboard/stock-forecast?weeks=4${filter.state ? `&state=${encodeURIComponent(filter.state)}` : ''}`);
  const outliers = useGet<Outliers>('/api/dashboard/outliers');
  const activity = useGet<Activity>('/api/dashboard/activity');
  const coverage = useGet<Coverage>('/api/dashboard/coverage-by-state');

  const canDrill = summary.data?.breakdownBy !== 'facility';
  function drillInto(key: string) {
    if (!summary.data || !canDrill) return;
    setFilter((f) => ({ ...f, [summary.data!.breakdownBy]: key }));
  }
  const crumbs = useMemo(() => {
    const c: Array<{ label: string; f: Filter }> = [{ label: 'Nigeria', f: {} }];
    if (filter.state) c.push({ label: filter.state, f: { state: filter.state } });
    if (filter.lga) c.push({ label: filter.lga, f: { state: filter.state, lga: filter.lga } });
    if (filter.ward) c.push({ label: filter.ward, f: filter });
    return c;
  }, [filter]);

  if (summary.loading && !summary.data) return <Loading label="Loading command centre…" />;
  if (summary.error) return <ErrorNote message={summary.error} />;
  if (!summary.data) return null;

  const t = summary.data.totals;
  const maxBreak = Math.max(1, ...summary.data.breakdown.map((b) => b.metrics.registered));

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="eyebrow">National overview</div>
          <h1>Command Centre</h1>
          <p className="muted dash-tagline">Real-time visibility across Nigeria's child immunisation journey.</p>
        </div>
        <Link to="/register" className="btn btn-primary">Register child</Link>
      </div>

      <nav className="scopebar" aria-label="Geographic scope">
        {crumbs.map((c, i) => (
          <span key={c.label} className="scope-crumb">
            <button className="scope-link" onClick={() => setFilter(c.f)} disabled={i === crumbs.length - 1}>{c.label}</button>
            {i < crumbs.length - 1 && <span className="scope-sep" aria-hidden>›</span>}
          </span>
        ))}
      </nav>

      {/* headline KPIs — matched to the reference set */}
      <div className="kpis">
        <Kpi
          label="Children registered"
          value={fmt(t.registered)}
          sub={`${fmt(t.onTrack)} on track · ${fmt(t.dueThisWeek)} due this week`}
        />
        <Kpi label="Doses administered" value={fmt(t.dosesAdministered)} sub="recorded in this scope" />
        <Kpi label="Children overdue" value={fmt(t.overdue)} tone="down" sub={`${fmt(summary.data.openEscalations)} in the follow-up queue`} />
        <Kpi
          label="Healthy Start active"
          value={fmt(summary.data.healthyStartActive)}
          tone="up"
          sub="12-month NHIA child coverage"
          badge="coverage"
        />
      </div>

      {/* status distribution */}
      <section className="card panel">
        <div className="panel-head">
          <h2>Child status distribution</h2>
          <span className="eyebrow">{summary.data.scope.label} · {fmt(t.registered)} children</span>
        </div>
        <StatusBar t={t} />
      </section>

      {/* Coverage by priority state — national triage, worst-first */}
      <section className="card panel">
        <div className="panel-head">
          <h2>Coverage by priority state</h2>
          <span className="eyebrow">ranked by children needing action</span>
        </div>
        {!coverage.data ? (
          <Loading />
        ) : coverage.data.states.length === 0 ? (
          <Empty>No states registered yet.</Empty>
        ) : (
          <div className="cbs-scroll">
            <table className="cbs">
              <thead>
                <tr>
                  <th>State</th>
                  <th className="num">Children</th>
                  <th className="num">Immunised</th>
                  <th className="num">Overdue</th>
                  <th className="num">Due this week</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {coverage.data.states.map((s) => (
                  <tr key={s.state} className="cbs-row" onClick={() => setFilter({ state: s.state })} title={`Drill into ${s.state}`}>
                    <td className="cbs-state">{s.state}</td>
                    <td className="num mono">{fmt(s.registered)}</td>
                    <td className="num">
                      <span className="cbs-comp">
                        <span className="cbs-comp-track"><span className="cbs-comp-fill" style={{ width: `${Math.round(s.completionRate * 100)}%` }} /></span>
                        <b className="mono">{pct(s.completionRate)}</b>
                      </span>
                    </td>
                    <td className="num mono cbs-overdue">{fmt(s.overdue)}</td>
                    <td className="num mono">{fmt(s.dueThisWeek)}</td>
                    <td><span className={`cbs-pill ${s.priority}`}>{PRIORITY_LABEL[s.priority]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="dash-grid">
        <section className="card panel span2">
          <div className="panel-head">
            <h2>{LEVEL_LABEL[summary.data.breakdownBy] ?? summary.data.breakdownBy}</h2>
            <span className="eyebrow">registered · overdue · completion</span>
          </div>
          {summary.data.breakdown.length === 0 ? (
            <Empty>No children registered in this scope yet.</Empty>
          ) : (
            <ul className="geo-list">
              {summary.data.breakdown.map((b) => (
                <li key={b.key}>
                  <button className="geo-row" onClick={() => drillInto(b.key)} disabled={!canDrill}>
                    <span className="geo-key">{b.key}</span>
                    <span className="geo-bar-track"><span className="geo-bar-fill" style={{ width: `${(b.metrics.registered / maxBreak) * 100}%` }} /></span>
                    <span className="geo-nums mono">
                      <b>{fmt(b.metrics.registered)}</b>
                      <span className="geo-overdue">{fmt(b.metrics.overdue)} overdue</span>
                      <span className="geo-comp">{pct(b.metrics.completionRate)}</span>
                    </span>
                    {canDrill && <span className="geo-drill" aria-hidden>›</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Doses administered</h2><span className="eyebrow">last 8 weeks</span></div>
          {trend.data ? <TrendChart points={trend.data.points} /> : <Loading />}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Live programme activity</h2><span className="eyebrow live">● live</span></div>
          {activity.data ? (
            activity.data.events.length === 0 ? <Empty>No recent events.</Empty> : (
              <ul className="activity">
                {activity.data.events.slice(0, 6).map((e, i) => (
                  <li key={i} className="act-row">
                    <span className={`act-dot ${e.kind}`} aria-hidden />
                    <span className="act-body">
                      <span className="act-label">{e.label}</span>
                      <span className="act-detail mono muted">{e.detail}</span>
                    </span>
                    <span className="act-time mono muted">{timeAgo(e.at)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : <Loading />}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Stock pressure</h2><span className="eyebrow">next 4 weeks</span></div>
          {stock.data ? (stock.data.byVaccine.length === 0 ? <Empty>No doses fall due in this window.</Empty> : <ForecastBars items={stock.data.byVaccine} />) : <Loading />}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Dropout outliers</h2><span className="eyebrow">facilities to review</span></div>
          {outliers.data ? (outliers.data.outliers.length === 0 ? <Empty>No facilities flagged.</Empty> : (
            <ul className="outlier-list">
              {outliers.data.outliers.map((o) => (
                <li key={`${o.facility}-${o.lga}`} className="outlier-row">
                  <div><div className="outlier-name">{o.facility}</div><div className="muted outlier-loc">{o.lga}, {o.state} · {o.registered} children</div></div>
                  <span className="outlier-rate mono">{pct(o.dropoutRate)}</span>
                </li>
              ))}
            </ul>
          )) : <Loading />}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, badge }: { label: string; value: string; sub?: string; tone?: 'up' | 'down'; badge?: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {badge && <span className={`kpi-badge ${tone ?? ''}`}>{badge}</span>}
      </div>
      <div className={`kpi-value${tone ? ` kpi-${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub muted">{sub}</div>}
    </div>
  );
}

function StatusBar({ t }: { t: Metrics }) {
  const segs = [
    { key: 'On track', n: t.onTrack, cls: 'GREEN' },
    { key: 'Due soon', n: t.dueThisWeek, cls: 'AMBER' },
    { key: 'Overdue', n: t.overdue, cls: 'RED' },
    { key: 'Completed', n: t.completed, cls: 'BLUE' },
    { key: 'Needs review', n: t.needsReconciliation, cls: 'GREY' }
  ].filter((s) => s.n > 0);
  const total = Math.max(1, segs.reduce((a, s) => a + s.n, 0));
  return (
    <div className="statusbar">
      <div className="statusbar-track">
        {segs.map((s) => (
          <span key={s.key} className={`sb-seg ${s.cls}`} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.key}: ${s.n}`} />
        ))}
      </div>
      <div className="statusbar-legend">
        {segs.map((s) => (
          <span key={s.key} className="sb-leg">
            <span className={`sb-swatch ${s.cls}`} />
            {s.key} <b className="mono">{fmt(s.n)}</b>
            <span className="muted">· {pct(s.n / total)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: Array<{ weekStarting: string; dosesAdministered: number }> }) {
  const max = Math.max(1, ...points.map((p) => p.dosesAdministered));
  return (
    <div className="trend">
      {points.map((p) => (
        <div key={p.weekStarting} className="trend-col" title={`${p.weekStarting}: ${p.dosesAdministered}`}>
          <div className="trend-bar" style={{ height: `${(p.dosesAdministered / max) * 100}%` }} />
          <div className="trend-x mono">{p.weekStarting.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

function ForecastBars({ items }: { items: Array<{ vaccineCode: string; dueCount: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.dueCount));
  return (
    <ul className="forecast">
      {items.map((i) => (
        <li key={i.vaccineCode} className="forecast-row">
          <span className="forecast-code mono">{i.vaccineCode}</span>
          <span className="forecast-track"><span className="forecast-fill" style={{ width: `${(i.dueCount / max) * 100}%` }} /></span>
          <span className="forecast-num mono">{fmt(i.dueCount)}</span>
        </li>
      ))}
    </ul>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
