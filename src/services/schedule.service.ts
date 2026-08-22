import { ROUTINE_IMMUNIZATION_SCHEDULE } from '../data/routine-immunization-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;

const AMBER_WINDOW_DAYS = 7; // due within this many days -> "due soon"

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

  if (doses.every((d) => d.administeredDate)) {
    return 'BLUE';
  }

  let worst: ChildStatusColor = 'GREEN';
  const rank: Record<'GREEN' | 'AMBER' | 'RED', number> = { GREEN: 0, AMBER: 1, RED: 2 };

  for (const dose of doses) {
    if (dose.administeredDate) continue;
    const doseStatus = computeDoseStatus(dose.dueDate, now);
    if (rank[doseStatus] > rank[worst as 'GREEN' | 'AMBER' | 'RED']) worst = doseStatus;
  }

  return worst;
}

export function isScheduleComplete(doses: DoseInput[]): boolean {
  return doses.length > 0 && doses.every((d) => d.administeredDate);
}
