import { ROUTINE_IMMUNIZATION_SCHEDULE } from '../data/routine-immunization-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;

const AMBER_WINDOW_DAYS = 7; // due within this many days -> "due soon"
const RED_GRACE_DAYS = 14; // overdue by more than this -> RED
const GREY_LOST_DAYS = 90; // overdue by more than this -> treat as lost-to-follow-up

export interface DoseInput {
  vaccineCode: string;
  displayName: string;
  doseNumber: number;
  dueDate: Date;
  administeredDate: Date | null;
}

export type ChildStatusColor = 'GREEN' | 'AMBER' | 'RED' | 'GREY' | 'BLUE';

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
    const daysUntilDue = (dose.dueDate.getTime() - now.getTime()) / DAY_MS;

    let doseStatus: ChildStatusColor;
    if (daysUntilDue > AMBER_WINDOW_DAYS) {
      doseStatus = 'GREEN';
    } else if (daysUntilDue >= -RED_GRACE_DAYS) {
      doseStatus = daysUntilDue >= 0 ? 'AMBER' : 'RED';
    } else if (daysUntilDue >= -GREY_LOST_DAYS) {
      doseStatus = 'RED';
    } else {
      doseStatus = 'GREY';
    }

    if (rank[doseStatus] > rank[worst]) worst = doseStatus;
  }

  return worst;
}

export function isScheduleComplete(doses: DoseInput[]): boolean {
  return doses.length > 0 && doses.every((d) => d.administeredDate);
}
