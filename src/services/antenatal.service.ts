import { PregnancyModel } from '../models/Pregnancy';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { ChildModel } from '../models/Child';
import { generateAncId, generateChin, normalizeChin } from './chin.service';
import { buildDosesForChild } from './schedule.service';
import { AppError } from '../utils/AppError';

/**
 * Antenatal registration (NCIHAP §19, extended) — opening the record before the
 * child is born, because antenatal contact is the strongest early predictor of
 * whether a child is ever vaccinated. See the header of models/Pregnancy.ts for
 * the evidence and the equity caveat.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * The threshold that matters. In the six-state Nigerian study, children of
 * mothers with FEWER THAN FOUR antenatal visits were zero-dose 35.0% of the
 * time against 17.1% above it — roughly double the risk. So a pregnancy sitting
 * below four visits as its due date approaches is a predicted zero-dose child,
 * identifiable before the child exists. That is the whole point of registering
 * here: it is the only moment the system can intervene before the gap rather
 * than chase the child after it.
 */
export const ANC_VISITS_AT_RISK = 4;

/** WHO's 2016 ANC model recommends a minimum of eight contacts. */
export const ANC_VISITS_RECOMMENDED = 8;

/** How long past the expected delivery date before we chase the birth. */
const OVERDUE_GRACE_DAYS = 14;

export type PregnancyRisk = 'at_risk' | 'on_track' | 'recommended';

/**
 * Risk band from antenatal contact alone. Deliberately keyed on visit COUNT and
 * nothing else — it is a service-contact signal, not a clinical judgement, and
 * must never read as one.
 */
export function classifyAncRisk(visitCount: number): PregnancyRisk {
  if (visitCount < ANC_VISITS_AT_RISK) return 'at_risk';
  if (visitCount < ANC_VISITS_RECOMMENDED) return 'on_track';
  return 'recommended';
}

export interface PregnancyView {
  ancId: string;
  caregiverName: string | null;
  caregiverPhone: string | null;
  facility: string;
  expectedDeliveryDate: Date;
  visitCount: number;
  risk: PregnancyRisk;
  status: string;
  linkedChin: string | null;
  daysToDelivery: number;
}

async function toView(p: any, now: Date): Promise<PregnancyView> {
  const [caregiver, facility] = await Promise.all([
    CaregiverModel.findById(p.caregiverId),
    FacilityModel.findById(p.facilityId)
  ]);
  return {
    ancId: p.ancId,
    caregiverName: caregiver?.fullName ?? null,
    caregiverPhone: caregiver?.phone || null,
    facility: facility?.name ?? '(unknown)',
    expectedDeliveryDate: p.expectedDeliveryDate,
    visitCount: p.visits.length,
    risk: classifyAncRisk(p.visits.length),
    status: p.status,
    linkedChin: p.linkedChin ?? null,
    daysToDelivery: Math.round((p.expectedDeliveryDate.getTime() - now.getTime()) / DAY)
  };
}

export async function registerPregnancy(input: {
  caregiverId: string;
  facilityId: string;
  expectedDeliveryDate: string | Date;
  registeredBy?: string;
}, now: Date = new Date()): Promise<PregnancyView> {
  const [caregiver, facility] = await Promise.all([
    CaregiverModel.findById(input.caregiverId),
    FacilityModel.findById(input.facilityId)
  ]);
  if (!caregiver) throw new AppError('caregiverId does not match a known caregiver', 404);
  if (!facility) throw new AppError('facilityId does not match a known facility', 404);

  const edd = new Date(input.expectedDeliveryDate);
  if (Number.isNaN(edd.getTime())) throw new AppError('expectedDeliveryDate is not a valid date');

  // Same collision guard as the CHIN — a health identifier does not get to
  // shrug at "unlikely".
  let ancId = generateAncId();
  for (let attempt = 0; attempt < 5 && (await PregnancyModel.exists({ ancId })); attempt++) {
    ancId = generateAncId();
  }

  const pregnancy = await PregnancyModel.create({
    ancId,
    caregiverId: input.caregiverId,
    facilityId: input.facilityId,
    expectedDeliveryDate: edd,
    registeredBy: input.registeredBy ?? ''
  });

  return toView(pregnancy, now);
}

export async function recordAncVisit(ancId: string, input: { date?: string | Date; facilityId?: string }, now: Date = new Date()): Promise<PregnancyView> {
  const pregnancy = await PregnancyModel.findOne({ ancId: normalizeChin(ancId) });
  if (!pregnancy) throw new AppError(`No antenatal record found with ID ${ancId}`, 404);
  if (pregnancy.status !== 'active') {
    throw new AppError(`This antenatal record is ${pregnancy.status}; visits can only be added while it is active`, 409);
  }

  const date = input.date ? new Date(input.date) : now;
  if (Number.isNaN(date.getTime())) throw new AppError('date is not a valid date');

  pregnancy.visits.push({
    visitNumber: pregnancy.visits.length + 1,
    date,
    facilityId: (input.facilityId ?? pregnancy.facilityId) as any
  });
  await pregnancy.save();

  return toView(pregnancy, now);
}

/**
 * The birth happened — convert the antenatal record into a child record.
 *
 * This is the handover the whole channel exists for: the child arrives already
 * known, with a caregiver and a phone number captured months earlier, so the
 * birth dose is recorded against a record that already exists rather than one
 * created retrospectively (or never created at all).
 */
export async function linkBirth(ancId: string, input: {
  fullName: string;
  sex: string;
  dateOfBirth: string | Date;
  birthSetting?: string;
  homeFacilityId?: string;
}, now: Date = new Date()): Promise<{ chin: string; ancId: string; ancVisits: number; risk: PregnancyRisk }> {
  const pregnancy = await PregnancyModel.findOne({ ancId: normalizeChin(ancId) });
  if (!pregnancy) throw new AppError(`No antenatal record found with ID ${ancId}`, 404);
  if (pregnancy.status === 'linked') {
    throw new AppError(`This antenatal record is already linked to child ${pregnancy.linkedChin}`, 409);
  }
  if (pregnancy.status === 'closed') {
    throw new AppError('This antenatal record is closed and cannot be linked', 409);
  }
  if (!input.fullName || !input.sex || !input.dateOfBirth) {
    throw new AppError('fullName, sex and dateOfBirth are required to link a birth');
  }
  if (input.sex !== 'male' && input.sex !== 'female') {
    throw new AppError("sex must be 'male' or 'female'");
  }
  const setting = input.birthSetting ?? 'facility';
  if (setting !== 'facility' && setting !== 'home' && setting !== 'other') {
    throw new AppError("birthSetting must be 'facility', 'home' or 'other'");
  }

  const dob = new Date(input.dateOfBirth);
  if (Number.isNaN(dob.getTime())) throw new AppError('dateOfBirth is not a valid date');

  const homeFacilityId = input.homeFacilityId ?? String(pregnancy.facilityId);
  const facility = await FacilityModel.findById(homeFacilityId);
  if (!facility) throw new AppError('homeFacilityId does not match a known facility', 404);

  let chin = generateChin(dob);
  for (let attempt = 0; attempt < 5 && (await ChildModel.exists({ chin })); attempt++) {
    chin = generateChin(dob);
  }

  const child = await ChildModel.create({
    chin,
    fullName: input.fullName,
    sex: input.sex,
    dateOfBirth: dob,
    // The caregiver carries across from the antenatal record — same person,
    // same phone, already reachable.
    caregiverId: pregnancy.caregiverId,
    homeFacilityId,
    currentFacilityId: homeFacilityId,
    birthSetting: setting,
    registrationChannel: 'antenatal',
    doses: buildDosesForChild(dob)
  });

  pregnancy.status = 'linked';
  pregnancy.linkedChildId = child._id as any;
  pregnancy.linkedChin = chin;
  pregnancy.linkedAt = now;
  await pregnancy.save();

  return { chin, ancId: pregnancy.ancId, ancVisits: pregnancy.visits.length, risk: classifyAncRisk(pregnancy.visits.length) };
}

/**
 * Close an antenatal record that will not produce a linked child. Exists so a
 * pregnancy loss is recorded once and then stops generating follow-up work,
 * rather than sitting 'active' in a queue chasing a birth that will not come.
 */
export async function closePregnancy(ancId: string, reason: string, now: Date = new Date()): Promise<PregnancyView> {
  const pregnancy = await PregnancyModel.findOne({ ancId: normalizeChin(ancId) });
  if (!pregnancy) throw new AppError(`No antenatal record found with ID ${ancId}`, 404);
  if (pregnancy.status === 'linked') throw new AppError('A linked antenatal record cannot be closed', 409);

  pregnancy.status = 'closed';
  pregnancy.closedReason = (['not_a_live_birth', 'moved_away', 'lost_to_followup', 'other'].includes(reason)
    ? reason
    : 'other') as any;
  pregnancy.closedAt = now;
  await pregnancy.save();

  return toView(pregnancy, now);
}

export interface AntenatalPipeline {
  active: number;
  linked: number;
  closed: number;
  /** Active pregnancies whose expected delivery date is inside the horizon. */
  expectedBirths: number;
  horizonWeeks: number;
  /** Contact bands — the risk signal, not a clinical measure. */
  byRisk: { atRisk: number; onTrack: number; recommended: number };
  /**
   * Active pregnancies past their expected delivery date plus a grace period.
   * These are the births the system has NOT heard about — disproportionately the
   * home births that produce zero-dose children. The most actionable list here.
   */
  awaitingBirth: number;
  /** Of the pregnancies that reached an outcome, how many produced a child record. */
  conversionRate: number;
  byArea: Array<{ area: string; expectedBirths: number; atRisk: number }>;
  generatedAt: string;
}

/**
 * The antenatal pipeline (§19 extended, feeding §18): what the registry knows
 * about children who have not been born yet — how many are coming, where, and
 * which of them are already predicted to be missed.
 *
 * Aggregate counts only, no individual data — same §24 contract as the rest of
 * the dashboard.
 */
export async function antenatalPipeline(weeks = 12, now: Date = new Date()): Promise<AntenatalPipeline> {
  const horizon = now.getTime() + weeks * 7 * DAY;
  const pregnancies = await PregnancyModel.find({});
  const facilities = await FacilityModel.find({});
  const stateById = new Map(facilities.map((f) => [String(f._id), f.stateName || '(unknown)']));

  let active = 0;
  let linked = 0;
  let closed = 0;
  let expectedBirths = 0;
  let awaitingBirth = 0;
  const risk = { atRisk: 0, onTrack: 0, recommended: 0 };
  const byArea = new Map<string, { expectedBirths: number; atRisk: number }>();

  for (const p of pregnancies) {
    if (p.status === 'linked') { linked += 1; continue; }
    if (p.status === 'closed') { closed += 1; continue; }

    active += 1;
    const band = classifyAncRisk(p.visits.length);
    if (band === 'at_risk') risk.atRisk += 1;
    else if (band === 'on_track') risk.onTrack += 1;
    else risk.recommended += 1;

    const edd = p.expectedDeliveryDate.getTime();
    if (edd < now.getTime() - OVERDUE_GRACE_DAYS * DAY) awaitingBirth += 1;

    if (edd >= now.getTime() && edd <= horizon) {
      expectedBirths += 1;
      const area = stateById.get(String(p.facilityId)) ?? '(unknown)';
      if (!byArea.has(area)) byArea.set(area, { expectedBirths: 0, atRisk: 0 });
      const row = byArea.get(area)!;
      row.expectedBirths += 1;
      if (band === 'at_risk') row.atRisk += 1;
    }
  }

  const resolved = linked + closed;

  return {
    active,
    linked,
    closed,
    expectedBirths,
    horizonWeeks: weeks,
    byRisk: risk,
    awaitingBirth,
    conversionRate: resolved ? Math.round((linked / resolved) * 1000) / 1000 : 0,
    byArea: [...byArea.entries()]
      .map(([area, v]) => ({ area, expectedBirths: v.expectedBirths, atRisk: v.atRisk }))
      .sort((a, b) => b.expectedBirths - a.expectedBirths),
    generatedAt: now.toISOString()
  };
}

/**
 * The antenatal follow-up list: active pregnancies a worker should act on,
 * worst-first. Two kinds of case, both predictive of a zero-dose child —
 * pregnancies past their due date the system has heard nothing about, and
 * pregnancies approaching delivery with fewer than four antenatal contacts.
 *
 * Carries names and phone numbers, so staff/admin only — never the aggregate
 * dashboard.
 */
export async function antenatalFollowUp(now: Date = new Date()): Promise<PregnancyView[]> {
  const pregnancies = await PregnancyModel.find({ status: 'active' });
  const views = await Promise.all(pregnancies.map((p) => toView(p, now)));

  return views
    .filter((v) => v.daysToDelivery < OVERDUE_GRACE_DAYS || v.risk === 'at_risk')
    .sort((a, b) => a.daysToDelivery - b.daysToDelivery);
}

/** Expected births inside a horizon — used by the §18 supply plan for birth doses. */
export async function expectedBirths(weeks: number, now: Date = new Date()): Promise<number> {
  const horizon = now.getTime() + weeks * 7 * DAY;
  const pregnancies = await PregnancyModel.find({ status: 'active' });
  return pregnancies.filter((p) => {
    const edd = p.expectedDeliveryDate.getTime();
    return edd >= now.getTime() && edd <= horizon;
  }).length;
}
