import { useMemo, useState } from 'react';
import { useGet } from '../lib/useGet';
import { Loading, ErrorNote, Empty, fmt, pct } from '../components/ui';
import './Dashboard.css';

interface Metrics {
  registered: number;
  dosesAdministered: number;
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
  vaccineUtilisation: Array<{ vaccineCode: string; administered: number }>;
  openEscalations: number;
  generatedAt: string;
}
interface Trend {
  weeks: number;
  points: Array<{ weekStarting: string; dosesAdministered: number }>;
}
interface Stock {
  weeks: number;
  byVaccine: Array<{ vaccineCode: string; dueCount: number }>;
}
interface Outliers {
  count: number;
  outliers: Array<{ facility: string; state: string; lga: string; registered: number; dropoutRate: number }>;
}

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

export function Dashboard() {
  const [filter, setFilter] = useState<Filter>({});
  const summary = useGet<Summary>(`/api/dashboard/summary${qs(filter)}`);
  const trend = useGet<Trend>('/api/dashboard/trend?weeks=8');
  const stock = useGet<Stock>(`/api/dashboard/stock-forecast?weeks=4${filter.state ? `&state=${encodeURIComponent(filter.state)}` : ''}`);
  const outliers = useGet<Outliers>('/api/dashboard/outliers');

  const canDrill = summary.data?.breakdownBy !== 'facility';

  function drillInto(key: string) {
    if (!summary.data || !canDrill) return;
    const by = summary.data.breakdownBy;
    setFilter((f) => ({ ...f, [by]: key }));
  }

  const crumbs = useMemo(() => {
    const c: Array<{ label: string; f: Filter }> = [{ label: 'Nigeria', f: {} }];
    if (filter.state) c.push({ label: filter.state, f: { state: filter.state } });
    if (filter.lga) c.push({ label: filter.lga, f: { state: filter.state, lga: filter.lga } });
    if (filter.ward) c.push({ label: filter.ward, f: filter });
    return c;
  }, [filter]);

  if (summary.loading && !summary.data) return <Loading label="Loading command dashboard…" />;
  if (summary.error) return <ErrorNote message={summary.error} />;
  if (!summary.data) return null;

  const t = summary.data.totals;
  const maxBreak = Math.max(1, ...summary.data.breakdown.map((b) => b.metrics.registered));

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="eyebrow">National Command Dashboard · NCIHAP §11</div>
          <h1>Where is every child on their health journey?</h1>
        </div>
        <div className="dash-generated mono muted">
          updated {new Date(summary.data.generatedAt).toLocaleString('en-NG', { hour12: false })}
        </div>
      </div>

      {/* scope breadcrumb / drill-up */}
      <nav className="scopebar" aria-label="Geographic scope">
        {crumbs.map((c, i) => (
          <span key={c.label} className="scope-crumb">
            <button className="scope-link" onClick={() => setFilter(c.f)} disabled={i === crumbs.length - 1}>
              {c.label}
            </button>
            {i < crumbs.length - 1 && <span className="scope-sep" aria-hidden>›</span>}
          </span>
        ))}
      </nav>

      {/* KPI tiles */}
      <div className="kpis">
        <Kpi label="Children registered" value={fmt(t.registered)} />
        <Kpi label="Overdue" value={fmt(t.overdue)} tone={t.overdue ? 'red' : undefined} />
        <Kpi label="Due this week" value={fmt(t.dueThisWeek)} tone={t.dueThisWeek ? 'amber' : undefined} />
        <Kpi label="Zero-dose" value={fmt(t.zeroDose)} tone={t.zeroDose ? 'grey' : undefined} />
        <Kpi label="Completion rate" value={pct(t.completionRate)} tone="green" />
        <Kpi label="Dropout rate" value={pct(t.dropoutRate)} tone={t.dropoutRate > 0.2 ? 'red' : undefined} />
      </div>

      <div className="dash-grid">
        {/* geographic breakdown (drill-down) */}
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
                    <span className="geo-bar-track">
                      <span
                        className="geo-bar-fill"
                        style={{ width: `${(b.metrics.registered / maxBreak) * 100}%` }}
                      />
                    </span>
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

        {/* trend */}
        <section className="card panel">
          <div className="panel-head">
            <h2>Doses administered</h2>
            <span className="eyebrow">last 8 weeks · national</span>
          </div>
          {trend.data ? <TrendChart points={trend.data.points} /> : <Loading />}
        </section>

        {/* stock forecast */}
        <section className="card panel">
          <div className="panel-head">
            <h2>Stock pressure</h2>
            <span className="eyebrow">doses due · next 4 weeks</span>
          </div>
          {stock.data ? (
            stock.data.byVaccine.length === 0 ? (
              <Empty>No doses fall due in this window.</Empty>
            ) : (
              <ForecastBars items={stock.data.byVaccine} />
            )
          ) : (
            <Loading />
          )}
        </section>

        {/* outliers */}
        <section className="card panel">
          <div className="panel-head">
            <h2>Dropout outliers</h2>
            <span className="eyebrow">facilities needing review</span>
          </div>
          {outliers.data ? (
            outliers.data.outliers.length === 0 ? (
              <Empty>No facilities flagged. Dropout is within normal range.</Empty>
            ) : (
              <ul className="outlier-list">
                {outliers.data.outliers.map((o) => (
                  <li key={`${o.facility}-${o.lga}`} className="outlier-row">
                    <div>
                      <div className="outlier-name">{o.facility}</div>
                      <div className="muted outlier-loc">{o.lga}, {o.state} · {o.registered} children</div>
                    </div>
                    <span className="outlier-rate mono">{pct(o.dropoutRate)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Loading />
          )}
        </section>

        {/* footer strip: escalations + reconciliation */}
        <section className="card panel span2 strip">
          <div className="strip-item">
            <span className="strip-num">{fmt(summary.data.openEscalations)}</span>
            <span className="muted">open follow-up cases (national)</span>
          </div>
          <div className="strip-div" />
          <div className="strip-item">
            <span className="strip-num">{fmt(t.needsReconciliation)}</span>
            <span className="muted">records needing reconciliation (GREY) in scope</span>
          </div>
          <div className="strip-div" />
          <div className="strip-item">
            <span className="strip-num">{fmt(t.dosesAdministered)}</span>
            <span className="muted">doses administered in scope</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'amber' | 'green' | 'grey' }) {
  return (
    <div className={`card kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
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
          <span className="forecast-track">
            <span className="forecast-fill" style={{ width: `${(i.dueCount / max) * 100}%` }} />
          </span>
          <span className="forecast-num mono">{fmt(i.dueCount)}</span>
        </li>
      ))}
    </ul>
  );
}
