import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { EscalationModel } from '../models/Escalation';
import { CertificateModel } from '../models/Certificate';
import { FacilityHandoffModel } from '../models/FacilityHandoff';
import { computeChildStatus } from './schedule.service';
import { computeMilestones } from './milestone.service';
import { coldChainCm3 } from '../data/routine-immunization-schedule';
import { expectedBirths } from './antenatal.service';
import { identityGap, type IdentityGap } from './birth-registration.service';

/**
 * The National Command Dashboard (NCIHAP §11): aggregated, privacy-protected
 * intelligence over the whole registry — no individual child data ever leaves
 * this layer, only counts and rates. Drillable Nigeria → State → LGA → Ward →
 * PHC. Admin-only at the route layer.
 *
 * Prototype note: this loads the registry and aggregates in memory, which is
 * fine at pilot scale. National scale would move the heavy counting into
 * incremental/materialised aggregates; the API shape here stays the same.
 */

const DAY = 24 * 60 * 60 * 1000;
const UNSPECIFIED_WARD = '(unspecified ward)';
const UNKNOWN = '(unknown)';

export interface GeoFilter {
  state?: string;
  lga?: string;
  ward?: string;
}

export interface Metrics {
  registered: number;
  dosesAdministered: number;
  onTrack: number; // status GREEN
  dueSoon: number; // status AMBER
  dueThisWeek: number; // upcoming un-administered dose within 7 days
  overdue: number; // status RED
  zeroDose: number; // registered but no dose administered yet
  completed: number; // status BLUE
  dropout: number; // started (≥1 dose) but now overdue on a later dose
  needsReconciliation: number; // status GREY
  completionRate: number; // completed / registered
  dropoutRate: number; // dropout / started
}

interface FacilityGeo {
  state: string;
  lga: string;
  ward: string;
  facility: string;
  facilityId: string;
}

interface ChildFacts {
  geo: FacilityGeo;
  administeredCount: number;
  status: string;
  dueThisWeek: boolean;
  overdue: boolean;
  zeroDose: boolean;
  completed: boolean;
  dropout: boolean;
  needsReconciliation: boolean;
}

function blank(): Omit<Metrics, 'completionRate' | 'dropoutRate'> {
  return {
    registered: 0,
    dosesAdministered: 0,
    onTrack: 0,
    dueSoon: 0,
    dueThisWeek: 0,
    overdue: 0,
    zeroDose: 0,
    completed: 0,
    dropout: 0,
    needsReconciliation: 0
  };
}

function accumulate(m: ReturnType<typeof blank>, c: ChildFacts) {
  m.registered += 1;
  m.dosesAdministered += c.administeredCount;
  if (c.status === 'GREEN') m.onTrack += 1;
  if (c.status === 'AMBER') m.dueSoon += 1;
  if (c.dueThisWeek) m.dueThisWeek += 1;
  if (c.overdue) m.overdue += 1;
  if (c.zeroDose) m.zeroDose += 1;
  if (c.completed) m.completed += 1;
  if (c.dropout) m.dropout += 1;
  if (c.needsReconciliation) m.needsReconciliation += 1;
}

function withRates(m: ReturnType<typeof blank>): Metrics {
  const started = m.registered - m.zeroDose;
  return {
    ...m,
    completionRate: m.registered ? round(m.completed / m.registered) : 0,
    dropoutRate: started ? round(m.dropout / started) : 0
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type PriorityLevel = 'red' | 'amber' | 'green';

/**
 * The single classification used everywhere a geographic unit is flagged
 * (states in the priority table, and LGAs/wards/facilities as you drill in): a
 * fifth of children overdue or completion under a third is red (needs
 * intervention now); the amber band is the early warning tier.
 */
export function classifyPriority(m: Metrics): PriorityLevel {
  // Priority keys on defaulting (overdue), not raw completion. Completion
  // naturally lags where the child population is young (many infants still
  // mid-schedule), so a state with no overdue children is on-track even if few
  // have finished yet — flagging it red would misdirect the recovery effort.
  // Children who are genuinely not being brought show up as overdue, and that
  // is what these flags and the recovery workflow act on.
  const overdueRate = m.registered ? m.overdue / m.registered : 0;
  if (overdueRate >= 0.2) return 'red';
  if (overdueRate >= 0.1) return 'amber';
  return 'green';
}

async function loadFacts(now: Date): Promise<ChildFacts[]> {
  const facilities = await FacilityModel.find({});
  const byId = new Map<string, FacilityGeo>();
  for (const f of facilities) {
    byId.set(String(f._id), {
      state: f.stateName || UNKNOWN,
      lga: f.lgaName || UNKNOWN,
      ward: f.wardName || UNSPECIFIED_WARD,
      facility: f.name || UNKNOWN,
      facilityId: String(f._id)
    });
  }

  const children = await ChildModel.find({});
  const facts: ChildFacts[] = [];
  for (const child of children) {
    const geo = byId.get(String(child.currentFacilityId)) ?? {
      state: UNKNOWN,
      lga: UNKNOWN,
      ward: UNSPECIFIED_WARD,
      facility: UNKNOWN,
      facilityId: ''
    };

    const doses = child.doses.map((d) => ({
      vaccineCode: d.vaccineCode,
      displayName: d.displayName,
      doseNumber: d.doseNumber,
      dueDate: d.dueDate,
      administeredDate: d.administeredDate ?? null
    }));

    const administeredCount = doses.filter((d) => d.administeredDate).length;
    const status = computeChildStatus(doses, { now, needsReconciliation: child.needsReconciliation });
    const dueThisWeek = doses.some(
      (d) => !d.administeredDate && d.dueDate.getTime() >= now.getTime() && d.dueDate.getTime() <= now.getTime() + 7 * DAY
    );
    const overdue = status === 'RED';

    facts.push({
      geo,
      administeredCount,
      status,
      dueThisWeek,
      overdue,
      zeroDose: administeredCount === 0,
      completed: status === 'BLUE',
      // Dropout (NCIHAP §3): a child who began vaccination but has since missed
      // a later scheduled dose.
      dropout: administeredCount >= 1 && overdue,
      needsReconciliation: status === 'GREY'
    });
  }
  return facts;
}

function inScope(geo: FacilityGeo, f: GeoFilter): boolean {
  if (f.state && geo.state !== f.state) return false;
  if (f.lga && geo.lga !== f.lga) return false;
  if (f.ward && geo.ward !== f.ward) return false;
  return true;
}

/** The level to break the current scope down by (one below the deepest filter). */
function nextLevel(f: GeoFilter): 'state' | 'lga' | 'ward' | 'facility' {
  if (f.ward) return 'facility';
  if (f.lga) return 'ward';
  if (f.state) return 'lga';
  return 'state';
}

export interface DashboardSummary {
  scope: { level: string; state?: string; lga?: string; ward?: string; label: string };
  totals: Metrics;
  breakdownBy: string;
  breakdown: Array<{ key: string; metrics: Metrics; priority: PriorityLevel }>;
  vaccineUtilisation: Array<{ vaccineCode: string; administered: number }>;
  openEscalations: number;
  healthyStartActive: number; // children with active NHIA coverage (national)
  generatedAt: string;
}

export async function geographicSummary(filter: GeoFilter, now: Date = new Date()): Promise<DashboardSummary> {
  const facts = await loadFacts(now);
  const scoped = facts.filter((c) => inScope(c.geo, filter));

  const totals = blank();
  const level = nextLevel(filter);
  const groups = new Map<string, ReturnType<typeof blank>>();
  const vaccineUtil = new Map<string, number>();

  for (const c of scoped) {
    accumulate(totals, c);
    const key = c.geo[level];
    let group = groups.get(key);
    if (!group) {
      group = blank();
      groups.set(key, group);
    }
    accumulate(group, c);
  }

  // Vaccine utilisation needs the actual administered doses, re-read here.
  const children = await ChildModel.find({});
  const facilities = await FacilityModel.find({});
  const geoById = new Map(facilities.map((f) => [String(f._id), { state: f.stateName, lga: f.lgaName, ward: f.wardName || UNSPECIFIED_WARD }]));
  for (const child of children) {
    const g = geoById.get(String(child.currentFacilityId));
    const geo = { state: g?.state ?? UNKNOWN, lga: g?.lga ?? UNKNOWN, ward: g?.ward ?? UNSPECIFIED_WARD, facility: '', facilityId: '' };
    if (!inScope(geo, filter)) continue;
    for (const d of child.doses) {
      if (d.administeredDate) vaccineUtil.set(d.vaccineCode, (vaccineUtil.get(d.vaccineCode) ?? 0) + 1);
    }
  }

  const openEscalations = await EscalationModel.countDocuments({ status: 'open' });
  const healthyStartActive = await CertificateModel.countDocuments({ coverageExpiresAt: { $gt: now } });

  const scopeLabel = [filter.state, filter.lga, filter.ward].filter(Boolean).join(' → ') || 'Nigeria';

  return {
    scope: { level: filter.ward ? 'ward' : filter.lga ? 'lga' : filter.state ? 'state' : 'national', ...filter, label: scopeLabel },
    totals: withRates(totals),
    breakdownBy: level,
    breakdown: [...groups.entries()]
      .map(([key, m]) => {
        const metrics = withRates(m);
        return { key, metrics, priority: classifyPriority(metrics) };
      })
      .sort((a, b) => b.metrics.registered - a.metrics.registered),
    vaccineUtilisation: [...vaccineUtil.entries()]
      .map(([vaccineCode, administered]) => ({ vaccineCode, administered }))
      .sort((a, b) => b.administered - a.administered),
    openEscalations,
    healthyStartActive,
    generatedAt: now.toISOString()
  };
}

export interface StatePriority {
  state: string;
  registered: number;
  dosesAdministered: number;
  onTrack: number;
  overdue: number;
  dueThisWeek: number;
  zeroDose: number;
  completed: number;
  completionRate: number;
  overdueRate: number;
  priority: PriorityLevel;
}

export interface CoverageByState {
  states: StatePriority[];
  generatedAt: string;
}

/**
 * Coverage by priority state (NCIHAP §11): the national triage view a
 * decision-maker opens first — every state ranked worst-first by the share of
 * its children who are overdue,
 * each carrying a red / amber / green flag. Unlike the drill-down list this is
 * always national and priority-ordered, so the states that need intervention
 * surface at the top regardless of where the user has drilled.
 */
export async function coverageByState(now: Date = new Date()): Promise<CoverageByState> {
  const summary = await geographicSummary({}, now);

  const states: StatePriority[] = summary.breakdown.map((b) => {
    const m = b.metrics;
    return {
      state: b.key,
      registered: m.registered,
      dosesAdministered: m.dosesAdministered,
      onTrack: m.onTrack,
      overdue: m.overdue,
      dueThisWeek: m.dueThisWeek,
      zeroDose: m.zeroDose,
      completed: m.completed,
      completionRate: m.completionRate,
      overdueRate: m.registered ? round(m.overdue / m.registered) : 0,
      priority: b.priority
    };
  });

  // Worst-first by the same measure the flag uses: the share of children
  // overdue. Completion is not mixed in, because it lags wherever children are
  // young (see classifyPriority) and would push a state with more children
  // overdue below one whose children just haven't finished yet.
  states.sort((a, b) => b.overdueRate - a.overdueRate || b.overdue - a.overdue || a.completionRate - b.completionRate);

  return { states, generatedAt: now.toISOString() };
}

export interface MilestoneAttainment {
  registered: number;
  birth: number;
  foundation: number;
  healthyStart: number;
  generatedAt: string;
}

/**
 * How far the country has moved along the staged incentive journey (NCIHAP §14):
 * how many children have reached each reward milestone. A funnel — birth badge →
 * foundation benefit → Healthy Start coverage — that shows where engagement is
 * being kept and where it drops off. Counts only, no individual data (§24).
 */
export async function milestoneAttainment(now: Date = new Date()): Promise<MilestoneAttainment> {
  const children = await ChildModel.find({});
  let birth = 0;
  let foundation = 0;
  let healthyStart = 0;
  for (const child of children) {
    const doses = child.doses.map((d) => ({
      vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber,
      dueDate: d.dueDate, administeredDate: d.administeredDate ?? null
    }));
    const byKey = Object.fromEntries(computeMilestones(doses, child.dateOfBirth).map((m) => [m.key, m]));
    if (byKey.birth?.attained) birth += 1;
    if (byKey.foundation?.attained) foundation += 1;
    if (byKey.healthy_start?.attained) healthyStart += 1;
  }
  return { registered: children.length, birth, foundation, healthyStart, generatedAt: now.toISOString() };
}

export interface RecoveryChild {
  chin: string;
  fullName: string;
  ageMonths: number;
  overdueVaccines: string[];
  /** Distinct vaccine codes among the overdue doses, most overdue first. */
  overdueCodes: string[];
  mostOverdueDays: number;
  caregiverName: string | null;
  caregiverPhone: string | null;
  facility: string;
}

/**
 * The recovery call list that closes the loop from the drill-down: the actual
 * overdue (RED) children in a scope — who they are, what they're overdue for,
 * how late, and how to reach them — so a worker at the worst facility can act,
 * not just see a number. Individual data, so it's staff/admin only (not part of
 * the aggregate, no-PII dashboard contract). Worst-overdue first.
 */
export async function overdueChildren(filter: GeoFilter, now: Date = new Date()): Promise<RecoveryChild[]> {
  const facilities = await FacilityModel.find({});
  const geoById = new Map(
    facilities.map((f) => [String(f._id), { state: f.stateName || UNKNOWN, lga: f.lgaName || UNKNOWN, ward: f.wardName || UNSPECIFIED_WARD, name: f.name || UNKNOWN }])
  );

  const children = await ChildModel.find({});
  const out: RecoveryChild[] = [];
  for (const child of children) {
    const g = geoById.get(String(child.currentFacilityId));
    const geo = { state: g?.state ?? UNKNOWN, lga: g?.lga ?? UNKNOWN, ward: g?.ward ?? UNSPECIFIED_WARD, facility: '', facilityId: '' };
    if (!inScope(geo, filter)) continue;

    const doses = child.doses.map((d) => ({ vaccineCode: d.vaccineCode, displayName: d.displayName, dueDate: d.dueDate, administeredDate: d.administeredDate ?? null }));
    const status = computeChildStatus(
      child.doses.map((d) => ({ vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber, dueDate: d.dueDate, administeredDate: d.administeredDate ?? null })),
      { now, needsReconciliation: child.needsReconciliation }
    );
    if (status !== 'RED') continue;

    const overdue = doses
      .filter((d) => !d.administeredDate && d.dueDate.getTime() < now.getTime())
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const caregiver = await CaregiverModel.findById(child.caregiverId);

    out.push({
      chin: child.chin,
      fullName: child.fullName,
      ageMonths: Math.floor((now.getTime() - child.dateOfBirth.getTime()) / (30.44 * DAY)),
      overdueVaccines: overdue.map((d) => d.displayName),
      overdueCodes: [...new Set(overdue.map((d) => d.vaccineCode))],
      mostOverdueDays: overdue.length ? Math.round((now.getTime() - overdue[0].dueDate.getTime()) / DAY) : 0,
      caregiverName: caregiver?.fullName ?? null,
      caregiverPhone: caregiver?.phone || null,
      facility: g?.name ?? UNKNOWN
    });
  }

  return out.sort((a, b) => b.mostOverdueDays - a.mostOverdueDays);
}

const CHANNEL_LABELS: Record<string, string> = {
  phc: 'PHC', hospital: 'Hospital', chw: 'Community health worker', mobile_team: 'Mobile team', outreach: 'Outreach', npc: 'NPC point'
};
const REASON_LABELS: Record<string, string> = {
  relocation: 'Relocation', displacement: 'Displaced', nomadic: 'Nomadic', migration: 'Migrant', outreach: 'Outreach', other: 'Other'
};

export interface RegistrationMobility {
  registered: number;
  birth: { facility: number; home: number; other: number };
  byChannel: Array<{ channel: string; label: string; count: number }>;
  mobility: {
    childrenMoved: number;
    totalMoves: number;
    crossStateMoves: number;
    byReason: Array<{ reason: string; label: string; count: number }>;
  };
  /**
   * §4: children with a health record but no civil registration. Reported here
   * rather than as its own view because it IS a registration fact — how many of
   * the children we have reached the state still cannot see, and therefore
   * cannot enrol in the coverage completing the schedule is meant to unlock.
   */
  identity: IdentityGap;
  generatedAt: string;
}

/**
 * Registration inclusion (§19) and population mobility (§20): where and how
 * children enter the registry — home births and CHW / mobile / outreach channels
 * are counted alongside PHCs, never excluded — and how much the population moves,
 * with cross-state transfers showing that the national record keeps continuity
 * as families relocate. Counts only (§24).
 */
export async function registrationMobility(now: Date = new Date()): Promise<RegistrationMobility> {
  const children = await ChildModel.find({});
  const facilities = await FacilityModel.find({});
  const stateById = new Map(facilities.map((f) => [String(f._id), f.stateName || UNKNOWN]));

  const birth = { facility: 0, home: 0, other: 0 };
  const channels = new Map<string, number>();
  for (const c of children) {
    const setting = (c.birthSetting ?? 'facility') as keyof typeof birth;
    if (birth[setting] !== undefined) birth[setting] += 1;
    const ch = c.registrationChannel ?? 'phc';
    channels.set(ch, (channels.get(ch) ?? 0) + 1);
  }

  const handoffs = await FacilityHandoffModel.find({});
  const reasons = new Map<string, number>();
  const movedChildren = new Set<string>();
  let crossState = 0;
  for (const h of handoffs) {
    movedChildren.add(String(h.childId));
    const r = h.reasonCategory ?? 'relocation';
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
    if (stateById.get(String(h.fromFacilityId)) !== stateById.get(String(h.toFacilityId))) crossState += 1;
  }

  const identity = await identityGap();

  return {
    registered: children.length,
    birth,
    identity,
    byChannel: [...channels.entries()]
      .map(([channel, count]) => ({ channel, label: CHANNEL_LABELS[channel] ?? channel, count }))
      .sort((a, b) => b.count - a.count),
    mobility: {
      childrenMoved: movedChildren.size,
      totalMoves: handoffs.length,
      crossStateMoves: crossState,
      byReason: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, label: REASON_LABELS[reason] ?? reason, count }))
        .sort((a, b) => b.count - a.count)
    },
    generatedAt: now.toISOString()
  };
}

export interface ActivityEvent {
  kind: 'healthy_start' | 'verification' | 'reminder' | 'recovery';
  label: string;
  detail: string;
  at: string;
}

/**
 * The Command Centre's live activity feed — recent verified national events,
 * composed from the real ledgers (coverage grants, terminal verifications,
 * reminders sent, follow-up assignments). NCIHAP §11 "real-time intervention".
 */
export async function recentActivity(limit = 12): Promise<ActivityEvent[]> {
  const [certs, escalations] = await Promise.all([
    CertificateModel.find({}).sort({ issuedAt: -1 }).limit(limit),
    EscalationModel.find({}).sort({ raisedAt: -1 }).limit(limit)
  ]);

  const events: ActivityEvent[] = [];
  for (const c of certs) {
    events.push({
      kind: 'healthy_start',
      label: 'Healthy Start activated',
      detail: `${c.chin} · NHIA coverage: ${c.coverageMonths} months`,
      at: (c.issuedAt ?? new Date()).toISOString()
    });
  }
  for (const e of escalations) {
    events.push({
      kind: 'recovery',
      label: e.status === 'resolved' ? 'Recovery case resolved' : 'Recovery case assigned',
      detail: `${e.chin} · ${e.doseKey}`,
      at: (e.raisedAt ?? new Date()).toISOString()
    });
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}

export interface StockForecast {
  weeks: number;
  scope: string;
  /** byWeek[i] is the doses due in week i+1 of the window (week 1 starts now). */
  byVaccine: Array<{ vaccineCode: string; dueCount: number; byWeek: number[] }>;
  generatedAt: string;
}

/**
 * NCIHAP §11 "stock pressure" / §18 supply intelligence: how many doses of
 * each vaccine will fall due in the next `weeks` weeks, so stock can be planned
 * ahead ("N children will need Vaccine X in the next 4 weeks").
 */
export async function stockForecast(weeks: number, filter: GeoFilter, now: Date = new Date()): Promise<StockForecast> {
  const horizon = now.getTime() + weeks * 7 * DAY;
  const children = await ChildModel.find({});
  const facilities = await FacilityModel.find({});
  const geoById = new Map(facilities.map((f) => [String(f._id), { state: f.stateName, lga: f.lgaName, ward: f.wardName || UNSPECIFIED_WARD, facility: f.name, facilityId: String(f._id) }]));

  const byVaccine = new Map<string, number[]>();
  for (const child of children) {
    const geo = geoById.get(String(child.currentFacilityId)) ?? { state: UNKNOWN, lga: UNKNOWN, ward: UNSPECIFIED_WARD, facility: UNKNOWN, facilityId: '' };
    if (!inScope(geo, filter)) continue;
    for (const d of child.doses) {
      if (d.administeredDate) continue;
      const due = d.dueDate.getTime();
      if (due >= now.getTime() && due <= horizon) {
        let perWeek = byVaccine.get(d.vaccineCode);
        if (!perWeek) {
          perWeek = new Array(weeks).fill(0);
          byVaccine.set(d.vaccineCode, perWeek);
        }
        // The horizon is inclusive, so a dose due at its very end lands in the last week.
        perWeek[Math.min(weeks - 1, Math.floor((due - now.getTime()) / (7 * DAY)))]++;
      }
    }
  }

  return {
    weeks,
    scope: [filter.state, filter.lga, filter.ward].filter(Boolean).join(' → ') || 'Nigeria',
    byVaccine: [...byVaccine.entries()]
      .map(([vaccineCode, byWeek]) => ({ vaccineCode, dueCount: byWeek.reduce((a, b) => a + b, 0), byWeek }))
      .sort((a, b) => b.dueCount - a.dueCount),
    generatedAt: now.toISOString()
  };
}

// --- Planning assumptions for supply intelligence (NCIHAP §18). These are
// deliberate, visible heuristics for a prototype — not clinical constants —
// surfaced with the numbers so a planner can see what they rest on. ---
// Per-antigen cold-chain volumes are now in routine-immunization-schedule.ts
// (coldChainCm3()), replacing the old flat 3 cm³/dose constant.
const DOSES_PER_VACCINATOR_PER_DAY = 40; // routine-session throughput per vaccinator
const WORKING_DAYS_PER_WEEK = 5;

export interface SupplyPlanArea {
  area: string;
  dueCount: number;
  coldChainLitres: number;
  vaccinatorsNeeded: number;
}

export interface SupplyPlan {
  scope: string;
  breakdownBy: string;
  horizonWeeks: number;
  totalDoses: number;
  demandByVaccine: Array<{ vaccineCode: string; dueCount: number; cm3PerDose: number; totalCm3: number }>;
  coldChain: { doses: number; litres: number };
  staffing: { vaccinatorDays: number; vaccinatorsNeeded: number };
  deployment: SupplyPlanArea[];
  outreach: { overdue: number; zeroDose: number };
  /**
   * Demand from children not yet born, taken from the antenatal register. The
   * forecast above can only see children already registered, so without this
   * the plan is structurally blind to birth-dose demand — every expected birth
   * needs BCG, OPV0 and HepB0 within days of delivery.
   */
  expectedBirths: { births: number; birthDoses: number; coldChainCm3: number; coldChainLitres: number };
  infrastructure: {
    facilities: number;
    coldChain: { functional: number; atRisk: number; down: number };
    access: { accessible: number; hardToReach: number; securityCompromised: number };
  };
  assumptions: { perAntigenVolumes: boolean; dosesPerVaccinatorPerDay: number; workingDaysPerWeek: number };
  generatedAt: string;
}

/**
 * Supply & deployment plan (NCIHAP §18): turn forecast demand into the numbers a
 * planner actually acts on — cold-chain volume, vaccinators needed, where to
 * deploy them (one geographic level down), and where active outreach is needed
 * (overdue + zero-dose). "N children will need Vaccine X in the next weeks" →
 * "so provision this much cold storage and this many vaccinators, here."
 */
export async function supplyPlan(weeks: number, filter: GeoFilter, now: Date = new Date()): Promise<SupplyPlan> {
  const horizon = now.getTime() + weeks * 7 * DAY;
  const level = nextLevel(filter);
  const children = await ChildModel.find({});
  const facilities = await FacilityModel.find({});
  const geoById = new Map(facilities.map((f) => [String(f._id), { state: f.stateName || UNKNOWN, lga: f.lgaName || UNKNOWN, ward: f.wardName || UNSPECIFIED_WARD, facility: f.name || UNKNOWN, facilityId: String(f._id) }]));

  const byVaccine = new Map<string, number>();
  const byArea = new Map<string, number>();
  let total = 0;
  let overdue = 0;
  let zeroDose = 0;

  for (const child of children) {
    const geo = geoById.get(String(child.currentFacilityId)) ?? { state: UNKNOWN, lga: UNKNOWN, ward: UNSPECIFIED_WARD, facility: UNKNOWN, facilityId: '' };
    if (!inScope(geo, filter)) continue;

    const doses = child.doses.map((d) => ({ vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber, dueDate: d.dueDate, administeredDate: d.administeredDate ?? null }));
    if (computeChildStatus(doses, { now, needsReconciliation: child.needsReconciliation }) === 'RED') overdue += 1;
    if (doses.every((d) => !d.administeredDate)) zeroDose += 1;

    const areaKey = geo[level as keyof typeof geo] as string;
    for (const d of doses) {
      if (d.administeredDate) continue;
      const due = d.dueDate.getTime();
      if (due >= now.getTime() && due <= horizon) {
        byVaccine.set(d.vaccineCode, (byVaccine.get(d.vaccineCode) ?? 0) + 1);
        byArea.set(areaKey, (byArea.get(areaKey) ?? 0) + 1);
        total += 1;
      }
    }
  }

  // Cold-chain volume now uses per-antigen WHO EPI figures instead of a flat constant.
  const totalCm3 = [...byVaccine.entries()].reduce((sum, [vc, cnt]) => sum + cnt * coldChainCm3(vc), 0);
  const litresFromCm3 = (cm3: number) => Math.round(cm3 / 100) / 10;
  const litresFromDoses = (doses: number, vaccineCode?: string) =>
    litresFromCm3(doses * (vaccineCode ? coldChainCm3(vaccineCode) : (total ? totalCm3 / total : 3)));
  const vaccinators = (doses: number) => Math.ceil(Math.ceil(doses / DOSES_PER_VACCINATOR_PER_DAY) / Math.max(1, weeks * WORKING_DAYS_PER_WEEK));
  const vaccinatorDays = Math.ceil(total / DOSES_PER_VACCINATOR_PER_DAY);

  // Facility infrastructure in scope: can these facilities actually store the
  // vaccines (§18 cold chain) and can workers reach the settlements (§19/§20)?
  const cc = { functional: 0, at_risk: 0, down: 0 };
  const ac = { accessible: 0, hard_to_reach: 0, security_compromised: 0 };
  let facilitiesInScope = 0;
  for (const f of facilities) {
    const geo = { state: f.stateName || UNKNOWN, lga: f.lgaName || UNKNOWN, ward: f.wardName || UNSPECIFIED_WARD, facility: '', facilityId: '' };
    if (!inScope(geo, filter)) continue;
    facilitiesInScope += 1;
    const cs = (f.coldChainStatus ?? 'functional') as keyof typeof cc;
    if (cc[cs] !== undefined) cc[cs] += 1;
    const as = (f.accessibility ?? 'accessible') as keyof typeof ac;
    if (ac[as] !== undefined) ac[as] += 1;
  }

  // Birth-dose demand from the antenatal register (§19 extended). Every
  // expected birth needs BCG + OPV0 + HepB0 within days of delivery — demand the
  // child-based forecast above cannot see, because those children do not exist
  // in the registry yet.
  const births = await expectedBirths(weeks, now);
  const birthDoseCm3 = coldChainCm3('BCG') + coldChainCm3('OPV') + coldChainCm3('HEPB');

  return {
    scope: [filter.state, filter.lga, filter.ward].filter(Boolean).join(' → ') || 'Nigeria',
    breakdownBy: level,
    horizonWeeks: weeks,
    totalDoses: total,
    demandByVaccine: [...byVaccine.entries()].map(([vaccineCode, dueCount]) => ({
      vaccineCode, dueCount,
      cm3PerDose: coldChainCm3(vaccineCode),
      totalCm3: dueCount * coldChainCm3(vaccineCode),
    })).sort((a, b) => b.dueCount - a.dueCount),
    coldChain: { doses: total, litres: litresFromCm3(totalCm3) },
    staffing: { vaccinatorDays, vaccinatorsNeeded: vaccinators(total) },
    deployment: [...byArea.entries()]
      .map(([area, dueCount]) => ({ area, dueCount, coldChainLitres: litresFromDoses(dueCount), vaccinatorsNeeded: vaccinators(dueCount) }))
      .sort((a, b) => b.dueCount - a.dueCount),
    outreach: { overdue, zeroDose },
    expectedBirths: {
      births,
      birthDoses: births * 3,
      // Both units: a pilot-scale cohort is a few tens of cm³, which rounds to
      // 0.0 L and reads as a bug. The caller picks the unit that carries signal.
      coldChainCm3: Math.round(births * birthDoseCm3 * 10) / 10,
      coldChainLitres: litresFromCm3(births * birthDoseCm3)
    },
    infrastructure: {
      facilities: facilitiesInScope,
      coldChain: { functional: cc.functional, atRisk: cc.at_risk, down: cc.down },
      access: { accessible: ac.accessible, hardToReach: ac.hard_to_reach, securityCompromised: ac.security_compromised }
    },
    assumptions: { perAntigenVolumes: true, dosesPerVaccinatorPerDay: DOSES_PER_VACCINATOR_PER_DAY, workingDaysPerWeek: WORKING_DAYS_PER_WEEK },
    generatedAt: now.toISOString()
  };
}

export interface AdministrationTrend {
  weeks: number;
  points: Array<{ weekStarting: string; dosesAdministered: number }>;
}

/** Doses administered per week over the last `weeks` weeks — a real trend from
 * administeredDate (NCIHAP §11 "performance trends"). */
export async function administrationTrend(weeks: number, filter: GeoFilter = {}, now: Date = new Date()): Promise<AdministrationTrend> {
  const buckets = new Map<string, number>();
  // Seed the last `weeks` week-start keys so quiet weeks still show as 0.
  const weekStart = (t: number) => {
    const d = new Date(t);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
  };
  for (let i = weeks - 1; i >= 0; i--) {
    buckets.set(weekStart(now.getTime() - i * 7 * DAY), 0);
  }
  const earliest = now.getTime() - weeks * 7 * DAY;

  const children = await ChildModel.find({});
  const facilities = await FacilityModel.find({});
  const geoById = new Map(facilities.map((f) => [String(f._id), { state: f.stateName, lga: f.lgaName, ward: f.wardName || UNSPECIFIED_WARD, facility: f.name, facilityId: String(f._id) }]));
  for (const child of children) {
    const geo = geoById.get(String(child.currentFacilityId)) ?? { state: UNKNOWN, lga: UNKNOWN, ward: UNSPECIFIED_WARD, facility: UNKNOWN, facilityId: '' };
    if (!inScope(geo, filter)) continue;
    for (const d of child.doses) {
      if (!d.administeredDate) continue;
      const t = d.administeredDate.getTime();
      if (t < earliest || t > now.getTime()) continue;
      const key = weekStart(t);
      const count = buckets.get(key);
      if (count !== undefined) buckets.set(key, count + 1);
    }
  }

  return {
    weeks,
    points: [...buckets.entries()].map(([weekStarting, dosesAdministered]) => ({ weekStarting, dosesAdministered }))
  };
}

export interface OutlierFacility {
  facility: string;
  state: string;
  lga: string;
  registered: number;
  dropoutRate: number;
}

export interface FacilityDropout {
  /** Mean dropout rate across eligible facilities. */
  average: number;
  /** Facilities above this rate (mean + 1 standard deviation) are outliers. */
  threshold: number;
  /** Eligible facilities in the requested area, highest dropout first. */
  facilities: Array<OutlierFacility & { ward: string; outlier: boolean }>;
}

/**
 * Dropout rate for every facility with enough children, ranked, alongside the
 * mean and the outlier threshold (NCIHAP §11 "facilities with unusual dropout
 * rates"). A facility is an outlier when its rate is above mean + 1 standard
 * deviation. Returning the whole ranking, not just the outliers, lets a
 * reviewer see the ones just under the line too.
 */
export async function facilityDropout(filter: GeoFilter = {}, minChildren = 5, now: Date = new Date()): Promise<FacilityDropout> {
  const facts = await loadFacts(now);
  const byFacility = new Map<string, { geo: FacilityGeo; m: ReturnType<typeof blank> }>();
  for (const c of facts) {
    const key = c.geo.facilityId || c.geo.facility;
    let entry = byFacility.get(key);
    if (!entry) {
      entry = { geo: c.geo, m: blank() };
      byFacility.set(key, entry);
    }
    accumulate(entry.m, c);
  }

  const eligible = [...byFacility.values()]
    .map(({ geo, m }) => ({ geo, metrics: withRates(m) }))
    .filter((f) => f.metrics.registered >= minChildren);

  if (eligible.length === 0) return { average: 0, threshold: 0, facilities: [] };

  const rates = eligible.map((f) => f.metrics.dropoutRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const threshold = mean + Math.sqrt(variance);

  return {
    average: round(mean),
    threshold: round(threshold),
    // The average and threshold are national, so "outlier" means unusual for
    // the country; the list itself is limited to the area being viewed.
    facilities: eligible
      .filter((f) => inScope(f.geo, filter))
      .map((f) => ({
        facility: f.geo.facility,
        state: f.geo.state,
        lga: f.geo.lga,
        ward: f.geo.ward,
        registered: f.metrics.registered,
        dropoutRate: f.metrics.dropoutRate,
        outlier: f.metrics.dropoutRate > threshold && f.metrics.dropoutRate > 0
      }))
      .sort((a, b) => b.dropoutRate - a.dropoutRate)
  };
}

