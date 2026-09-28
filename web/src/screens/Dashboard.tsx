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
  breakdown: Array<{ key: string; metrics: Metrics; priority: 'red' | 'amber' | 'green' }>;
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
interface RecoveryChild { chin: string; fullName: string; ageMonths: number; overdueVaccines: string[]; mostOverdueDays: number; caregiverName: string | null; caregiverPhone: string | null; facility: string; }
interface Recovery { count: number; children: RecoveryChild[]; }

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

type GeoSort = 'overdue' | 'registered' | 'completion';
const GEO_SORTS: Array<{ key: GeoSort; label: string }> = [
  { key: 'overdue', label: 'Most overdue' },
  { key: 'registered', label: 'Most children' },
  { key: 'completion', label: 'Lowest completion' }
];

export function Dashboard() {
  const [filter, setFilter] = useState<Filter>({});
  const [geoSort, setGeoSort] = useState<GeoSort>('overdue');
  const summary = useGet<Summary>(`/api/dashboard/summary${qs(filter)}`);
  const trend = useGet<Trend>('/api/dashboard/trend?weeks=8');
  const stock = useGet<Stock>(`/api/dashboard/stock-forecast?weeks=4${filter.state ? `&state=${encodeURIComponent(filter.state)}` : ''}`);
  const outliers = useGet<Outliers>('/api/dashboard/outliers');
  const coverage = useGet<Coverage>('/api/dashboard/coverage-by-state');
  // Only fetched once drilled to a facility (ward scope) — this carries names
  // and phone numbers, so we don't pull it at the national/state level.
  const recovery = useGet<Recovery>(filter.ward ? `/api/recovery${qs(filter)}` : null);

  const canDrill = summary.data?.breakdownBy !== 'facility';
  function drillInto(key: string) {
    if (!summary.data || !canDrill) return;
    const level = summary.data.breakdownBy;
    setFilter((f) => ({ ...f, [level]: key }));
  }
  const crumbs = useMemo(() => {
    const c: Array<{ label: string; f: Filter }> = [{ label: 'Nigeria', f: {} }];
    if (filter.state) c.push({ label: filter.state, f: { state: filter.state } });
    if (filter.lga) c.push({ label: filter.lga, f: { state: filter.state, lga: filter.lga } });
    if (filter.ward) c.push({ label: filter.ward, f: filter });
    return c;
  }, [filter]);

  if (summary.loading && !summary.data) return <Loading label="Loading overview…" />;
  if (summary.error) return <ErrorNote message={summary.error} />;
  if (!summary.data) return null;

  const t = summary.data.totals;
  const national = !filter.state;
  const maxBreak = Math.max(1, ...summary.data.breakdown.map((b) => b.metrics.registered));
  const sortedBreakdown = [...summary.data.breakdown].sort((a, b) => {
    if (geoSort === 'registered') return b.metrics.registered - a.metrics.registered;
    if (geoSort === 'completion') return a.metrics.completionRate - b.metrics.completionRate;
    // 'overdue' (default triage order): most overdue children first.
    return b.metrics.overdue - a.metrics.overdue || a.metrics.completionRate - b.metrics.completionRate;
  });

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>Overview</h1>
        </div>
        <Link to="/register" className="btn btn-primary">Register child</Link>
      </div>

      <nav className="scopebar" aria-label="Geographic scope">
        {crumbs.map((c, i) => (
          <span key={c.label} className="scope-crumb">
            <button type="button" className="scope-link" onClick={() => setFilter(c.f)} disabled={i === crumbs.length - 1}>{c.label}</button>
            {i < crumbs.length - 1 && <span className="scope-sep" aria-hidden>›</span>}
          </span>
        ))}
      </nav>

      {/* headline KPIs, matched to the reference set */}
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

      {/* National level: the state table is the drill list. Below national,
          the breakdown list further down takes over, so states aren't shown twice. */}
      {national && (
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
      )}

      <div className="dash-grid">
        {!national && (
        <section className="card panel span2">
          <div className="panel-head">
            <h2>{LEVEL_LABEL[summary.data.breakdownBy] ?? summary.data.breakdownBy}</h2>
            {/* biome-ignore lint/a11y/useSemanticElements: a <fieldset> would bring its own border and legend styling to this toolbar */}
            <div className="geo-sort" role="group" aria-label="Sort areas by">
              {GEO_SORTS.map((s) => (
                <button type="button" key={s.key} className={`geo-sort-btn${geoSort === s.key ? ' active' : ''}`} onClick={() => setGeoSort(s.key)}>{s.label}</button>
              ))}
            </div>
          </div>
          {sortedBreakdown.length === 0 ? (
            <Empty>No children registered in this scope yet.</Empty>
          ) : (
            <ul className="geo-list">
              {sortedBreakdown.map((b) => (
                <li key={b.key}>
                  <button type="button" className="geo-row" onClick={() => drillInto(b.key)} disabled={!canDrill}>
                    <span className={`geo-flag ${b.priority}`} aria-hidden title={b.priority} />
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
        )}

        <section className="card panel span2">
          <div className="panel-head"><h2>Doses administered</h2><span className="eyebrow">last 8 weeks</span></div>
          {trend.data ? <TrendChart points={trend.data.points} /> : <Loading />}
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

      {/* Recovery call list: closes the loop from the worst facility to action */}
      {filter.ward && (
        <section className="card panel">
          <div className="panel-head">
            <h2>Overdue children: recovery list</h2>
            <span className="eyebrow">{summary.data.scope.label} · {recovery.data ? `${recovery.data.count} to reach` : '…'}</span>
          </div>
          {!recovery.data ? (
            <Loading />
          ) : recovery.data.children.length === 0 ? (
            <Empty>No overdue children here. Nothing to recover.</Empty>
          ) : (
            <div className="rec-scroll">
              <table className="rec">
                <thead>
                  <tr><th>Child</th><th>Overdue for</th><th className="num">Days late</th><th>Caregiver</th><th></th></tr>
                </thead>
                <tbody>
                  {recovery.data.children.map((c) => (
                    <tr key={c.chin} className="rec-row">
                      <td>
                        <div className="rec-name">{c.fullName}</div>
                        <div className="muted rec-sub mono">{c.chin} · {c.ageMonths}mo</div>
                      </td>
                      <td className="rec-vax">{c.overdueVaccines.slice(0, 3).join(', ')}{c.overdueVaccines.length > 3 ? ` +${c.overdueVaccines.length - 3}` : ''}</td>
                      <td className="num mono rec-late">{c.mostOverdueDays}d</td>
                      <td>
                        <div>{c.caregiverName ?? '-'}</div>
                        {c.caregiverPhone && <a className="rec-phone mono" href={`tel:${c.caregiverPhone}`}>{c.caregiverPhone}</a>}
                      </td>
                      <td className="num"><Link to={`/care?chin=${encodeURIComponent(c.chin)}`} className="btn btn-sm">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
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

