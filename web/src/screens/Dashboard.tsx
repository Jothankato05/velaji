import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../lib/useGet';
import { Loading, ErrorNote, Empty, fmt, pct } from '../components/ui';
import './Dashboard.css';

interface Metrics {
  registered: number;
  dosesAdministered: number;
  onTrack: number;
  dueSoon: number;
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
interface Stock { weeks: number; generatedAt: string; byVaccine: Array<{ vaccineCode: string; dueCount: number; byWeek: number[] }>; }
interface Outliers {
  average: number;
  threshold: number;
  facilities: Array<{ facility: string; state: string; lga: string; registered: number; dropoutRate: number; outlier: boolean }>;
}
interface RecoveryChild { chin: string; fullName: string; ageMonths: number; overdueVaccines: string[]; overdueCodes: string[]; mostOverdueDays: number; caregiverName: string | null; caregiverPhone: string | null; facility: string; }
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
  const stock = useGet<Stock>(`/api/dashboard/stock-forecast?weeks=4${qs(filter).replace('?', '&')}`);
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
          <span className="eyebrow">select a state to drill in</span>
        </div>
        {!coverage.data ? (
          <Loading />
        ) : coverage.data.states.length === 0 ? (
          <Empty>No states registered yet.</Empty>
        ) : (
          <>
          <div className="cbs-scroll">
            <table className="cbs">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Status</th>
                  <th className="num">Overdue</th>
                  <th className="num hide-sm">Due this week</th>
                  <th className="num hide-sm">Fully immunised</th>
                  <th className="num hide-sm">Children</th>
                </tr>
              </thead>
              <tbody>
                {coverage.data.states.map((s) => (
                  <tr key={s.state} className="cbs-row">
                    <td>
                      <button type="button" className="cbs-state" onClick={() => setFilter({ state: s.state })}>
                        {s.state} <span className="cbs-drill" aria-hidden>›</span>
                      </button>
                    </td>
                    <td><span className={`cbs-pill ${s.priority}`}>{PRIORITY_LABEL[s.priority]}</span></td>
                    <td className="num">
                      <span className={s.overdue > 0 ? 'cbs-overdue' : 'muted'}>{fmt(s.overdue)}</span>
                      {s.overdue > 0 && <span className="muted cbs-share"> {pct(s.overdueRate)}</span>}
                    </td>
                    <td className="num hide-sm">{fmt(s.dueThisWeek)}</td>
                    <td className="num hide-sm">
                      <span className="cbs-comp">
                        <span className="cbs-comp-track"><span className="cbs-comp-fill" style={{ width: `${Math.round(s.completionRate * 100)}%` }} /></span>
                        <span>{pct(s.completionRate)}</span>
                      </span>
                    </td>
                    <td className="num hide-sm">{fmt(s.registered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted cbs-note">
            Ranked by the share of each state's children who are overdue. Priority: 20% or more overdue; watch: 10% or more.
            Fully immunised counts children who have had every scheduled dose, so it is naturally low where children are young.
          </p>
          </>
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
          <div className="panel-head"><h2>Doses needed</h2><span className="eyebrow">per vaccine, by week starting</span></div>
          {stock.data ? (stock.data.byVaccine.length === 0 ? <Empty>No doses fall due in this window.</Empty> : <DemandByWeek stock={stock.data} />) : <Loading />}
        </section>

        <section className="card panel">
          <div className="panel-head">
            <h2>Dropout by facility</h2>
            {outliers.data && outliers.data.facilities.length > 0 && (
              <span className="eyebrow">average {pct(outliers.data.average)} · flagged above {pct(outliers.data.threshold)}</span>
            )}
          </div>
          {outliers.data ? (outliers.data.facilities.length === 0 ? <Empty>No facility has enough children to compare yet.</Empty> : <DropoutRanking d={outliers.data} />) : <Loading />}
        </section>

      </div>

      {/* Recovery call list: closes the loop from the worst facility to action */}
      {filter.ward && (
        <section className="card panel">
          <div className="panel-head">
            <h2>Overdue children to contact</h2>
            <span className="eyebrow">{summary.data.scope.label} · {recovery.data ? `${recovery.data.count} children` : '…'}</span>
          </div>
          {!recovery.data ? (
            <Loading />
          ) : recovery.data.children.length === 0 ? (
            <Empty>No overdue children here. Nothing to recover.</Empty>
          ) : (
            <RecoveryTable rows={recovery.data.children} />
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

/** Each child has exactly one status, so the segments partition the registered
 *  children and always add up to the total. */
function StatusBar({ t }: { t: Metrics }) {
  const segs = [
    { key: 'On track', n: t.onTrack, cls: 'GREEN' },
    { key: 'Due soon', n: t.dueSoon, cls: 'AMBER' },
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

const RECOVERY_SHOWN = 8;

/** Most overdue first. Missed doses are summarised as a count plus vaccine
 *  codes (the full names are in the tooltip), and only the first few children
 *  show until asked, so a busy ward stays scannable. */
function RecoveryTable({ rows }: { rows: RecoveryChild[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, RECOVERY_SHOWN);
  return (
    <>
      <div className="rec-scroll">
        <table className="rec">
          <thead>
            <tr><th>Child</th><th>Missed</th><th className="num">Days late</th><th>Caregiver</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.chin} className="rec-row">
                <td>
                  <div className="rec-name">{c.fullName}</div>
                  <div className="muted rec-sub">{c.chin} · {c.ageMonths} mo</div>
                </td>
                <td className="rec-vax" title={c.overdueVaccines.join(', ')}>
                  <div>{c.overdueVaccines.length} dose{c.overdueVaccines.length === 1 ? '' : 's'}</div>
                  <div className="muted rec-sub">
                    {c.overdueCodes.slice(0, 5).join(', ')}{c.overdueCodes.length > 5 ? ` +${c.overdueCodes.length - 5}` : ''}
                  </div>
                </td>
                <td className="num rec-late">{c.mostOverdueDays}</td>
                <td>
                  <div className="rec-carer">{c.caregiverName ?? '-'}</div>
                  {c.caregiverPhone && <a className="rec-phone" href={`tel:${c.caregiverPhone}`}>{c.caregiverPhone}</a>}
                </td>
                <td className="num"><Link to={`/care?chin=${encodeURIComponent(c.chin)}`} className="btn btn-sm">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > RECOVERY_SHOWN && (
        <button type="button" className="btn btn-sm rec-more" onClick={() => setAll((v) => !v)}>
          {all ? `Show the ${RECOVERY_SHOWN} most overdue` : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

const DROPOUT_SHOWN = 6;

/** Worst facilities first, each against the average (the tick on every bar).
 *  Outliers, well above the average, are flagged in red; the rest are shown
 *  for context so a facility just under the line isn't invisible. */
function DropoutRanking({ d }: { d: Outliers }) {
  const shown = d.facilities.slice(0, DROPOUT_SHOWN);
  return (
    <>
      <ul className="dropout-list">
        {shown.map((f) => (
          <li key={`${f.facility}-${f.lga}`} className={`dropout-row${f.outlier ? ' outlier' : ''}`}>
            <div className="dropout-who">
              <span className="dropout-name">{f.facility}</span>
              <span className="muted dropout-loc">{f.lga}, {f.state} · {f.registered} children</span>
            </div>
            <span className="dropout-track" aria-hidden>
              <span className="dropout-fill" style={{ width: `${f.dropoutRate * 100}%` }} />
              <span className="dropout-avg" style={{ left: `${d.average * 100}%` }} />
            </span>
            <span className="dropout-rate">{pct(f.dropoutRate)}</span>
            {f.outlier ? <span className="dropout-flag">Outlier</span> : <span />}
          </li>
        ))}
      </ul>
      <p className="muted dropout-note">
        Dropout: children who started vaccines but are now overdue. The line on each bar is the average.
        {d.facilities.length > DROPOUT_SHOWN && ` Showing the ${DROPOUT_SHOWN} highest of ${d.facilities.length} facilities.`}
      </p>
    </>
  );
}

function TrendChart({ points }: { points: Array<{ weekStarting: string; dosesAdministered: number }> }) {
  const max = Math.max(1, ...points.map((p) => p.dosesAdministered));
  return (
    <div className="trend">
      {points.map((p, i) => {
        // The last week is still in progress, so it's labelled and drawn lighter
        // rather than reading as a drop.
        const current = i === points.length - 1;
        const label = current
          ? 'This week'
          : new Date(`${p.weekStarting}T00:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return (
          <div key={p.weekStarting} className="trend-col" title={`Week starting ${p.weekStarting}: ${fmt(p.dosesAdministered)} doses`}>
            <span className="trend-n">{fmt(p.dosesAdministered)}</span>
            <div className="trend-plot">
              <div className={`trend-bar${current ? ' current' : ''}`} style={{ height: `${(p.dosesAdministered / max) * 100}%` }} />
            </div>
            <div className="trend-x">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Vaccines given at the same visit (Penta, OPV, PCV, Rota at 6/10/14 weeks)
 *  have identical demand, so they share a row rather than repeating it. Each
 *  cell is shaded by its share of the busiest week, so the weeks that need
 *  delivering stand out. */
function DemandByWeek({ stock }: { stock: Stock }) {
  const rows: Array<{ codes: string[]; byWeek: number[]; total: number }> = [];
  for (const v of stock.byVaccine) {
    const same = rows.find((r) => r.byWeek.join() === v.byWeek.join());
    if (same) same.codes.push(v.vaccineCode);
    else rows.push({ codes: [v.vaccineCode], byWeek: v.byWeek, total: v.dueCount });
  }
  const peak = Math.max(1, ...rows.flatMap((r) => r.byWeek));
  const start = new Date(stock.generatedAt);
  const weekLabel = (i: number) =>
    new Date(start.getTime() + i * 7 * 86400000).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  return (
    <div className="cbs-scroll">
      <table className="demand">
        <thead>
          <tr>
            <th>Vaccine</th>
            {stock.byVaccine[0].byWeek.map((_, i) => <th key={weekLabel(i)} className="num">{weekLabel(i)}</th>)}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.codes.join()}>
              <td className="demand-codes">
                {r.codes.join(', ')}
                {r.codes.length > 1 && <div className="muted demand-note">Given at the same visit</div>}
              </td>
              {r.byWeek.map((n, i) => (
                <td key={weekLabel(i)} className="num demand-cell" style={{ background: n ? `rgba(154, 107, 18, ${0.08 + 0.42 * (n / peak)})` : undefined }}>
                  {n ? fmt(n) : <span className="muted">–</span>}
                </td>
              ))}
              <td className="num demand-total">{fmt(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

