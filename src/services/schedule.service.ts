import { ROUTINE_IMMUNIZATION_SCHEDULE } from '../data/routine-immunization-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;

const AMBER_WINDOW_DAYS = 7; // due within this many days -> "due soon"
const GREY_LOST_DAYS = 90; // overdue by more than this -> treat as lost-to-follow-up

export interface DoseInput {
  vaccineCode: string;
  displayName: string;
  doseNumber: number;
  dueDate: Date;
  administeredDate: Date | null;
}

export type ChildStatusColor = 'GREEN' | 'AMBER' | 'RED' | 'GREY' | 'BLUE';

/** Per-dose status for a single un-administered dose. Never returns BLUE. */
export type DoseStatusColor = 'GREEN' | 'AMBER' | 'RED' | 'GREY';

/**
 * Status of one un-administered dose relative to now. An administered dose has
 * no pending status, so callers must filter those out first.
 */
export function computeDoseStatus(dueDate: Date, now: Date = new Date()): DoseStatusColor {
  const daysUntilDue = (dueDate.getTime() - now.getTime()) / DAY_MS;
  if (daysUntilDue > AMBER_WINDOW_DAYS) return 'GREEN';
  if (daysUntilDue >= 0) return 'AMBER';
  if (daysUntilDue >= -GREY_LOST_DAYS) return 'RED';
  return 'GREY';
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

/**
 * The five-color at-a-glance status model from the programme notes:
 * BLUE = complete, GREEN = on track, AMBER = due soon, RED = overdue,
 * GREY = lost to follow-up (severely overdue, needs active outreach/tracing
 * rather than just a reminder).
 */
export function computeChildStatus(doses: DoseInput[], now: Date = new Date()): ChildStatusColor {
  if (doses.length > 0 && doses.every((d) => d.administeredDate)) {
    return 'BLUE';
  }

  let worst: ChildStatusColor = 'GREEN';
  const rank: Record<ChildStatusColor, number> = { GREEN: 0, AMBER: 1, RED: 2, GREY: 3, BLUE: 4 };

  for (const dose of doses) {
    if (dose.administeredDate) continue;
    const doseStatus = computeDoseStatus(dose.dueDate, now);
    if (rank[doseStatus] > rank[worst]) worst = doseStatus;
  }

  return worst;
}

export function isScheduleComplete(doses: DoseInput[]): boolean {
  return doses.length > 0 && doses.every((d) => d.administeredDate);
}
