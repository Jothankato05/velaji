import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { EscalationModel } from '../models/Escalation';
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
  breakdown: Array<{ key: string; metrics: Metrics }>;
  vaccineUtilisation: Array<{ vaccineCode: string; administered: number }>;
  openEscalations: number;
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

  const scopeLabel = [filter.state, filter.lga, filter.ward].filter(Boolean).join(' → ') || 'Nigeria';

  return {
    scope: { level: filter.ward ? 'ward' : filter.lga ? 'lga' : filter.state ? 'state' : 'national', ...filter, label: scopeLabel },
    totals: withRates(totals),
    breakdownBy: level,
    breakdown: [...groups.entries()]
      .map(([key, m]) => ({ key, metrics: withRates(m) }))
      .sort((a, b) => b.metrics.registered - a.metrics.registered),
    vaccineUtilisation: [...vaccineUtil.entries()]
      .map(([vaccineCode, administered]) => ({ vaccineCode, administered }))
      .sort((a, b) => b.administered - a.administered),
    openEscalations,
    generatedAt: now.toISOString()
  };
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
