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
interface Milestones { registered: number; birth: number; foundation: number; healthyStart: number; }
interface FraudAlerts { count: number; alerts: Array<{ kind: string; worker: string; role: string; count: number; detail: string; at: string }>; }
interface RegMobility {
  registered: number;
  birth: { facility: number; home: number; other: number };
  byChannel: Array<{ channel: string; label: string; count: number }>;
  mobility: { childrenMoved: number; totalMoves: number; crossStateMoves: number; byReason: Array<{ reason: string; label: string; count: number }> };
}
interface DefaultingReasons { total: number; reasons: Array<{ barrier: string; label: string; count: number }>; }
interface Trend { points: Array<{ weekStarting: string; dosesAdministered: number }>; }
interface Stock { byVaccine: Array<{ vaccineCode: string; dueCount: number }>; }
interface SupplyPlan {
  scope: string; breakdownBy: string; horizonWeeks: number; totalDoses: number;
  coldChain: { doses: number; litres: number };
  staffing: { vaccinatorDays: number; vaccinatorsNeeded: number };
  deployment: Array<{ area: string; dueCount: number; coldChainLitres: number; vaccinatorsNeeded: number }>;
  outreach: { overdue: number; zeroDose: number };
  infrastructure: {
    facilities: number;
    coldChain: { functional: number; atRisk: number; down: number };
    access: { accessible: number; hardToReach: number; securityCompromised: number };
  };
  demandByVaccine: Array<{ vaccineCode: string; dueCount: number; cm3PerDose: number; totalCm3: number }>;
  expectedBirths: { births: number; birthDoses: number; coldChainCm3: number; coldChainLitres: number };
  assumptions: { perAntigenVolumes: boolean; dosesPerVaccinatorPerDay: number; workingDaysPerWeek: number };
}
interface Antenatal {
  active: number; linked: number; closed: number;
  expectedBirths: number; horizonWeeks: number;
  byRisk: { atRisk: number; onTrack: number; recommended: number };
  awaitingBirth: number; conversionRate: number;
  byArea: Array<{ area: string; expectedBirths: number; atRisk: number }>;
}
interface Outliers { outliers: Array<{ facility: string; state: string; lga: string; registered: number; dropoutRate: number }>; }
interface Activity { events: Array<{ kind: string; label: string; detail: string; at: string }>; }
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
  const supply = useGet<SupplyPlan>(`/api/dashboard/supply-plan?weeks=4${qs(filter).replace('?', '&')}`);
  const outliers = useGet<Outliers>('/api/dashboard/outliers');
  const activity = useGet<Activity>('/api/dashboard/activity');
  const coverage = useGet<Coverage>('/api/dashboard/coverage-by-state');
  const milestones = useGet<Milestones>('/api/dashboard/milestones');
  const integrity = useGet<FraudAlerts>('/api/fraud/alerts');
  const regMob = useGet<RegMobility>('/api/dashboard/registration-mobility');
  const barriers = useGet<DefaultingReasons>('/api/dashboard/defaulting-reasons');
  const antenatal = useGet<Antenatal>('/api/dashboard/antenatal?weeks=12');
  // Only fetched once drilled to a facility (ward scope) — this carries names
  // and phone numbers, so we don't pull it at the national/state level.
  const recovery = useGet<Recovery>(filter.ward ? `/api/recovery${qs(filter)}` : null);

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
            <div className="geo-sort" role="group" aria-label="Sort areas by">
              {GEO_SORTS.map((s) => (
                <button key={s.key} className={`geo-sort-btn${geoSort === s.key ? ' active' : ''}`} onClick={() => setGeoSort(s.key)}>{s.label}</button>
              ))}
            </div>
          </div>
          {sortedBreakdown.length === 0 ? (
            <Empty>No children registered in this scope yet.</Empty>
          ) : (
            <ul className="geo-list">
              {sortedBreakdown.map((b) => (
                <li key={b.key}>
                  <button className="geo-row" onClick={() => drillInto(b.key)} disabled={!canDrill}>
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

        <section className="card panel">
          <div className="panel-head"><h2>Doses administered</h2><span className="eyebrow">last 8 weeks</span></div>
          {trend.data ? <TrendChart points={trend.data.points} /> : <Loading />}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Reward milestones</h2><span className="eyebrow">staged incentive funnel</span></div>
          {milestones.data ? <MilestoneFunnel m={milestones.data} /> : <Loading />}
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

        <section className="card panel">
          <div className="panel-head"><h2>Integrity alerts</h2><span className="eyebrow">recording patterns to review</span></div>
          {!integrity.data ? <Loading /> : integrity.data.alerts.length === 0 ? (
            <Empty>No unusual recording activity flagged.</Empty>
          ) : (
            <ul className="integrity-list">
              {integrity.data.alerts.map((a, i) => (
                <li key={i} className="integrity-row">
                  <span className={`integrity-tag ${a.kind}`}>{a.kind === 'velocity' ? 'Throughput' : 'Duplicates'}</span>
                  <div className="integrity-body">
                    <div className="integrity-who mono">{a.worker} <span className="muted">· {a.role}</span></div>
                    <div className="muted integrity-detail">{a.detail}</div>
                  </div>
                  <span className="integrity-count mono">{fmt(a.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Registration &amp; mobility</h2><span className="eyebrow">inclusion &amp; continuity</span></div>
          {!regMob.data ? <Loading /> : <RegMobilityPanel m={regMob.data} />}
        </section>

        <section className="card panel">
          <div className="panel-head"><h2>Why children default</h2><span className="eyebrow">barriers from traced cases</span></div>
          {!barriers.data ? <Loading /> : barriers.data.total === 0 ? (
            <Empty>No barriers recorded yet — they're captured when a traced case is resolved.</Empty>
          ) : (
            <ul className="regmob-bars">
              {barriers.data.reasons.map((r) => (
                <li key={r.barrier} className="regmob-row">
                  <span className="regmob-label">{r.label}</span>
                  <span className="regmob-track"><span className="regmob-fill barrier" style={{ width: `${(r.count / Math.max(1, barriers.data!.total)) * 100}%` }} /></span>
                  <span className="regmob-num mono">{fmt(r.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Antenatal pipeline — children not yet born. Antenatal contact is the
          strongest early predictor of whether a child is ever vaccinated, so
          this is the only view that can flag a likely zero-dose child BEFORE
          the child exists. */}
      <section className="card panel">
        <div className="panel-head">
          <h2>Antenatal pipeline</h2>
          <span className="eyebrow">children not yet born · next {antenatal.data?.horizonWeeks ?? 12} weeks</span>
        </div>
        {!antenatal.data ? <Loading /> : antenatal.data.active + antenatal.data.linked === 0 ? (
          <Empty>No antenatal registrations yet — pregnancies registered at ANC appear here.</Empty>
        ) : (
          <>
            <div className="plan-tiles">
              <div className="plan-tile"><span className="plan-tile-v mono">{fmt(antenatal.data.active)}</span><span className="plan-tile-l">Active pregnancies</span></div>
              <div className="plan-tile"><span className="plan-tile-v mono">{fmt(antenatal.data.expectedBirths)}</span><span className="plan-tile-l">Births expected in window</span></div>
              <div className="plan-tile down"><span className="plan-tile-v mono">{fmt(antenatal.data.byRisk.atRisk)}</span><span className="plan-tile-l">Under 4 contacts · double zero-dose risk</span></div>
              <div className="plan-tile down"><span className="plan-tile-v mono">{fmt(antenatal.data.awaitingBirth)}</span><span className="plan-tile-l">Past due date, birth not reported</span></div>
            </div>
            {antenatal.data.byArea.length > 0 && (
              <div className="cbs-scroll">
                <table className="cbs">
                  <thead><tr><th>State</th><th className="num">Births expected</th><th className="num">Under 4 contacts</th></tr></thead>
                  <tbody>
                    {antenatal.data.byArea.map((a) => (
                      <tr key={a.area}>
                        <td className="cbs-state">{a.area}</td>
                        <td className="num mono">{fmt(a.expectedBirths)}</td>
                        <td className="num mono">{fmt(a.atRisk)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="plan-note muted">
              {fmt(antenatal.data.linked)} pregnancies have converted to child records ({Math.round(antenatal.data.conversionRate * 100)}% of those resolved).
              Fewer than four antenatal contacts is associated with roughly double the zero-dose rate (35.0% vs 17.1%, six Nigerian states) — a service-contact signal, not a clinical judgement.
              Antenatal is an additional channel: around 37% of women attend no ANC at all, so it never replaces the CHW, home-birth and outreach routes.
            </div>
          </>
        )}
      </section>

      {/* Supply & deployment plan — turns forecast demand into cold-chain, staffing, deployment */}
      <section className="card panel">
        <div className="panel-head">
          <h2>Supply &amp; deployment plan</h2>
          <span className="eyebrow">next 4 weeks · {summary.data.scope.label}</span>
        </div>
        {!supply.data ? <Loading /> : supply.data.totalDoses === 0 ? (
          <Empty>No doses fall due in this window.</Empty>
        ) : (
          <>
            <div className="plan-tiles">
              <div className="plan-tile"><span className="plan-tile-v mono">{fmt(supply.data.totalDoses)}</span><span className="plan-tile-l">Doses due</span></div>
              <div className="plan-tile"><span className="plan-tile-v mono">{supply.data.coldChain.litres} L</span><span className="plan-tile-l">Cold-chain volume</span></div>
              <div className="plan-tile"><span className="plan-tile-v mono">{fmt(supply.data.staffing.vaccinatorsNeeded)}</span><span className="plan-tile-l">Vaccinators · {fmt(supply.data.staffing.vaccinatorDays)} vaccinator-days</span></div>
              <div className="plan-tile down"><span className="plan-tile-v mono">{fmt(supply.data.outreach.overdue + supply.data.outreach.zeroDose)}</span><span className="plan-tile-l">Need outreach · {fmt(supply.data.outreach.overdue)} overdue, {fmt(supply.data.outreach.zeroDose)} zero-dose</span></div>
            </div>
            {supply.data.expectedBirths.births > 0 && (
              <div className="plan-infra">
                <span className="plan-infra-item">
                  Plus <b className="mono">{fmt(supply.data.expectedBirths.birthDoses)}</b> birth doses for <b className="mono">{fmt(supply.data.expectedBirths.births)}</b> expected births
                  (BCG, OPV0, HepB0 · <b className="mono">{supply.data.expectedBirths.coldChainLitres >= 0.1 ? `${supply.data.expectedBirths.coldChainLitres} L` : `${supply.data.expectedBirths.coldChainCm3} cm³`}</b>) — demand the child register alone cannot see.
                </span>
              </div>
            )}
            <div className="cbs-scroll">
              <table className="cbs">
                <thead><tr><th>Deploy to · {LEVEL_LABEL[supply.data.breakdownBy] ?? supply.data.breakdownBy}</th><th className="num">Doses</th><th className="num">Cold-chain (L)</th><th className="num">Vaccinators</th></tr></thead>
                <tbody>
                  {supply.data.deployment.map((a) => (
                    <tr key={a.area}><td className="cbs-state">{a.area}</td><td className="num mono">{fmt(a.dueCount)}</td><td className="num mono">{a.coldChainLitres}</td><td className="num mono">{fmt(a.vaccinatorsNeeded)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {supply.data.infrastructure.facilities > 0 && (
              <div className="plan-infra">
                <span className="plan-infra-item">
                  <b className="mono">{supply.data.infrastructure.coldChain.atRisk + supply.data.infrastructure.coldChain.down}</b> of {supply.data.infrastructure.facilities} facilities have <b>cold-chain at risk / down</b>
                </span>
                {(supply.data.infrastructure.access.securityCompromised + supply.data.infrastructure.access.hardToReach) > 0 && (
                  <span className="plan-infra-item warn">
                    <b className="mono">{supply.data.infrastructure.access.securityCompromised + supply.data.infrastructure.access.hardToReach}</b> need <b>dedicated outreach</b> (hard-to-reach / security-compromised)
                  </span>
                )}
              </div>
            )}
            {supply.data.demandByVaccine.length > 0 && (
              <div className="cbs-scroll">
                <table className="cbs">
                  <thead><tr><th>Antigen</th><th className="num">Doses due</th><th className="num">cm³/dose</th><th className="num">Volume (L)</th></tr></thead>
                  <tbody>
                    {supply.data.demandByVaccine.map((v) => (
                      <tr key={v.vaccineCode}>
                        <td className="cbs-state">{v.vaccineCode}</td>
                        <td className="num mono">{fmt(v.dueCount)}</td>
                        <td className="num mono">{v.cm3PerDose}</td>
                        <td className="num mono">{Math.round(v.totalCm3 / 100) / 10}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="plan-note muted">
              Planning estimate — cold-chain volume uses per-antigen WHO EPI packed volumes (BCG ~0.9, Penta ~3.1, MR ~5.2 cm³/dose incl. diluent) · {supply.data.assumptions.dosesPerVaccinatorPerDay} doses/vaccinator/day · {supply.data.assumptions.workingDaysPerWeek}-day week. Cold-chain / access reflect recorded facility status. Not clinical figures.
            </div>
          </>
        )}
      </section>

      {/* Recovery call list — closes the loop from the worst facility to action */}
      {filter.ward && (
        <section className="card panel">
          <div className="panel-head">
            <h2>Overdue children — recovery list</h2>
            <span className="eyebrow">{summary.data.scope.label} · {recovery.data ? `${recovery.data.count} to reach` : '…'}</span>
          </div>
          {!recovery.data ? (
            <Loading />
          ) : recovery.data.children.length === 0 ? (
            <Empty>No overdue children here — nothing to recover.</Empty>
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
                        <div>{c.caregiverName ?? '—'}</div>
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

function RegMobilityPanel({ m }: { m: RegMobility }) {
  const base = Math.max(1, m.registered);
  const homeShare = m.birth.home + m.birth.other;
  return (
    <div className="regmob">
      <div className="regmob-line">
        <span className="regmob-key">Home / non-facility births</span>
        <span className="regmob-val mono"><b>{fmt(homeShare)}</b><span className="muted">· {pct(homeShare / base)}</span></span>
      </div>
      <ul className="regmob-bars">
        {m.byChannel.map((c) => (
          <li key={c.channel} className="regmob-row">
            <span className="regmob-label">{c.label}</span>
            <span className="regmob-track"><span className="regmob-fill" style={{ width: `${(c.count / base) * 100}%` }} /></span>
            <span className="regmob-num mono">{fmt(c.count)}</span>
          </li>
        ))}
      </ul>
      <div className="regmob-mobility">
        <div className="regmob-line">
          <span className="regmob-key">Children who relocated</span>
          <span className="regmob-val mono"><b>{fmt(m.mobility.childrenMoved)}</b><span className="muted">· {fmt(m.mobility.crossStateMoves)} cross-state</span></span>
        </div>
        {m.mobility.byReason.length > 0 && (
          <div className="regmob-chips">
            {m.mobility.byReason.map((r) => (
              <span key={r.reason} className="regmob-chip">{r.label} <b className="mono">{fmt(r.count)}</b></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MilestoneFunnel({ m }: { m: Milestones }) {
  const base = Math.max(1, m.registered);
  const stages = [
    { key: 'birth', label: 'Birth Start', reward: 'Digital badge', n: m.birth },
    { key: 'foundation', label: 'Foundation', reward: 'Wellness benefit', n: m.foundation },
    { key: 'healthy', label: 'Healthy Start', reward: 'NHIA coverage', n: m.healthyStart }
  ];
  return (
    <ul className="funnel">
      {stages.map((s) => (
        <li key={s.key} className="funnel-row">
          <span className="funnel-label">{s.label}<span className="funnel-reward muted">{s.reward}</span></span>
          <span className="funnel-track"><span className={`funnel-fill ${s.key}`} style={{ width: `${(s.n / base) * 100}%` }} /></span>
          <span className="funnel-num mono"><b>{fmt(s.n)}</b><span className="muted">{pct(s.n / base)}</span></span>
        </li>
      ))}
    </ul>
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
