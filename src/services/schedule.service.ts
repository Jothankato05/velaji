import { ROUTINE_IMMUNIZATION_SCHEDULE } from '../data/routine-immunization-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;

const AMBER_WINDOW_DAYS = 7; // due within this many days -> "due soon"

/** Per dose (VACCINE#n): days after the due date it can still be given. */
const WINDOW_DAYS = new Map(
  ROUTINE_IMMUNIZATION_SCHEDULE.filter((e) => e.windowDays !== undefined).map((e) => [`${e.vaccineCode}#${e.doseNumber}`, e.windowDays as number])
);

/** The days after its due date a dose can still be given, or null for no limit. */
export function doseWindowDays(d: Pick<DoseInput, 'vaccineCode' | 'doseNumber'>): number | null {
  return WINDOW_DAYS.get(`${d.vaccineCode}#${d.doseNumber}`) ?? null;
}

/**
 * Not given, and past the age it can be given at (e.g. birth polio drops after
 * two weeks). Such a dose is no longer overdue, isn't offered, and doesn't stop
 * the schedule completing.
 */
export function isWindowClosed(d: DoseInput, now: Date = new Date()): boolean {
  if (d.administeredDate) return false;
  const w = doseWindowDays(d);
  return w !== null && now.getTime() > d.dueDate.getTime() + (w + 1) * DAY_MS;
}

/** Given, or no longer givable: nothing more to do for this dose. */
export function isSettled(d: DoseInput, now: Date = new Date()): boolean {
  return Boolean(d.administeredDate) || isWindowClosed(d, now);
}

/** Every dose settled, and at least one actually given. */
export function isScheduleComplete(doses: DoseInput[], now: Date = new Date()): boolean {
  return doses.some((d) => d.administeredDate) && doses.every((d) => isSettled(d, now));
}

export interface DoseInput {
  vaccineCode: string;
  displayName: string;
  doseNumber: number;
  dueDate: Date;
  administeredDate: Date | null;
}

export type ChildStatusColor = 'GREEN' | 'AMBER' | 'RED' | 'GREY' | 'BLUE';

/**
 * Per-dose status for a single un-administered dose. Never GREY (GREY is a
 * record-level state — see computeChildStatus) and never BLUE.
 */
export type DoseStatusColor = 'GREEN' | 'AMBER' | 'RED';

/**
 * Status of one un-administered dose relative to now. An administered dose has
 * no pending status, so callers must filter those out first. A missed dose is
 * RED however long it stays overdue — the spec (NCIHAP §10) keeps overdue as
 * RED and does not escalate it to GREY with age.
 */
export function computeDoseStatus(dueDate: Date, now: Date = new Date()): DoseStatusColor {
  const daysUntilDue = (dueDate.getTime() - now.getTime()) / DAY_MS;
  if (daysUntilDue > AMBER_WINDOW_DAYS) return 'GREEN';
  if (daysUntilDue >= 0) return 'AMBER';
  return 'RED';
}

export function buildDosesForChild(dateOfBirth: Date): DoseInput[] {
  return ROUTINE_IMMUNIZATION_SCHEDULE.map((entry) => ({
    vaccineCode: entry.vaccineCode,
    displayName: entry.displayName,
    doseNumber: entry.doseNumber,
    dueDate: new Date(dateOfBirth.getTime() + entry.dueOffsetDays * DAY_MS),
    administeredDate: null
  }));
}

export interface ChildStatusInput {
  now?: Date;
  /** NCIHAP §10: a record that is unverified/incomplete and needs reconciliation. */
  needsReconciliation?: boolean;
}

/**
 * The five-colour at-a-glance status model, exactly per NCIHAP §10:
 *   GREEN  — on track (schedule current)
 *   AMBER  — due soon (upcoming vaccination)
 *   RED    — overdue (a scheduled vaccination has been missed, any age)
 *   GREY   — unverified / INCOMPLETE record, requires reconciliation
 *   BLUE   — schedule completed (age-appropriate programme complete)
 *
 * GREY is a property of the RECORD, not of how late a dose is — a flagged
 * reconciliation case, or a record with no schedule to evaluate. It is not
 * produced by a dose simply being very overdue (that stays RED).
 */
export function computeChildStatus(doses: DoseInput[], opts: ChildStatusInput = {}): ChildStatusColor {
  const now = opts.now ?? new Date();

  // Unverified / incomplete record → reconciliation needed.
  if (opts.needsReconciliation || doses.length === 0) {
    return 'GREY';
  }

  if (isScheduleComplete(doses, now)) {
    return 'BLUE';
  }

  let worst: ChildStatusColor = 'GREEN';
  const rank: Record<'GREEN' | 'AMBER' | 'RED', number> = { GREEN: 0, AMBER: 1, RED: 2 };

  for (const dose of doses) {
    if (isSettled(dose, now)) continue;
    const doseStatus = computeDoseStatus(dose.dueDate, now);
    if (rank[doseStatus] > rank[worst as 'GREEN' | 'AMBER' | 'RED']) worst = doseStatus;
  }

  return worst;
}


