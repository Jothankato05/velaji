import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { EscalationModel } from '../models/Escalation';
import { CertificateModel } from '../models/Certificate';
import { computeChildStatus } from './schedule.service';

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
  const overdueRate = m.registered ? m.overdue / m.registered : 0;
  if (overdueRate >= 0.2 || m.completionRate < 0.35) return 'red';
  if (overdueRate >= 0.1 || m.completionRate < 0.6) return 'amber';
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
    if (!groups.has(key)) groups.set(key, blank());
    accumulate(groups.get(key)!, c);
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
 * decision-maker opens first — every state ranked worst-first by the pressure
 * it's under (overdue children and how far its schedule completion has fallen),
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

  // Worst-first: weight overdue pressure and the shortfall from full completion.
  const score = (s: StatePriority) => s.overdueRate * 2 + (1 - s.completionRate);
  states.sort((a, b) => score(b) - score(a));

  return { states, generatedAt: now.toISOString() };
}

export interface RecoveryChild {
  chin: string;
  fullName: string;
  ageMonths: number;
  overdueVaccines: string[];
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

    const doses = child.doses.map((d) => ({ displayName: d.displayName, dueDate: d.dueDate, administeredDate: d.administeredDate ?? null }));
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
      mostOverdueDays: overdue.length ? Math.round((now.getTime() - overdue[0].dueDate.getTime()) / DAY) : 0,
      caregiverName: caregiver?.fullName ?? null,
      caregiverPhone: caregiver?.phone || null,
      facility: g?.name ?? UNKNOWN
    });
  }

  return out.sort((a, b) => b.mostOverdueDays - a.mostOverdueDays);
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
  byVaccine: Array<{ vaccineCode: string; dueCount: number }>;
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

  const byVaccine = new Map<string, number>();
  for (const child of children) {
    const geo = geoById.get(String(child.currentFacilityId)) ?? { state: UNKNOWN, lga: UNKNOWN, ward: UNSPECIFIED_WARD, facility: UNKNOWN, facilityId: '' };
    if (!inScope(geo, filter)) continue;
    for (const d of child.doses) {
      if (d.administeredDate) continue;
      const due = d.dueDate.getTime();
      if (due >= now.getTime() && due <= horizon) {
        byVaccine.set(d.vaccineCode, (byVaccine.get(d.vaccineCode) ?? 0) + 1);
      }
    }
  }

  return {
    weeks,
    scope: [filter.state, filter.lga, filter.ward].filter(Boolean).join(' → ') || 'Nigeria',
    byVaccine: [...byVaccine.entries()]
      .map(([vaccineCode, dueCount]) => ({ vaccineCode, dueCount }))
      .sort((a, b) => b.dueCount - a.dueCount),
    generatedAt: now.toISOString()
  };
}

export interface AdministrationTrend {
  weeks: number;
  points: Array<{ weekStarting: string; dosesAdministered: number }>;
}

/** Doses administered per week over the last `weeks` weeks — a real trend from
 * administeredDate (NCIHAP §11 "performance trends"). */
export async function administrationTrend(weeks: number, now: Date = new Date()): Promise<AdministrationTrend> {
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
  for (const child of children) {
    for (const d of child.doses) {
      if (!d.administeredDate) continue;
      const t = d.administeredDate.getTime();
      if (t < earliest || t > now.getTime()) continue;
      const key = weekStart(t);
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
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

/**
 * Facilities whose dropout rate is an outlier — high relative to the national
 * mean (NCIHAP §11 "facilities with unusual dropout rates"). Flags facilities
 * with enough children and a dropout rate above mean + 1 standard deviation.
 */
export async function facilityOutliers(minChildren = 5, now: Date = new Date()): Promise<OutlierFacility[]> {
  const facts = await loadFacts(now);
  const byFacility = new Map<string, { geo: FacilityGeo; m: ReturnType<typeof blank> }>();
  for (const c of facts) {
    const key = c.geo.facilityId || c.geo.facility;
    if (!byFacility.has(key)) byFacility.set(key, { geo: c.geo, m: blank() });
    accumulate(byFacility.get(key)!.m, c);
  }

  const eligible = [...byFacility.values()]
    .map(({ geo, m }) => ({ geo, metrics: withRates(m) }))
    .filter((f) => f.metrics.registered >= minChildren);

  if (eligible.length === 0) return [];

  const rates = eligible.map((f) => f.metrics.dropoutRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const std = Math.sqrt(variance);
  const threshold = mean + std;

  return eligible
    .filter((f) => f.metrics.dropoutRate > threshold && f.metrics.dropoutRate > 0)
    .map((f) => ({
      facility: f.geo.facility,
      state: f.geo.state,
      lga: f.geo.lga,
      registered: f.metrics.registered,
      dropoutRate: f.metrics.dropoutRate
    }))
    .sort((a, b) => b.dropoutRate - a.dropoutRate);
}
