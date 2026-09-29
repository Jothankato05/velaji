/**
 * When a dose may be given. Two rules, so a nurse is never offered a dose that
 * wouldn't count:
 *
 *  1. Not before the dose's due age, less a 4-day grace (WHO's accepted grace
 *     period for doses given slightly early).
 *  2. Within a series (dose 1, 2, 3 of the same vaccine), not before the
 *     previous dose, and at least 28 days after it. So a child who missed
 *     months gets Penta 1 today and Penta 2 four weeks later, never both at
 *     once. Birth doses (dose 0, e.g. OPV at birth) stand apart from the series.
 *
 * Prototype reference rules like the schedule itself: a health authority must
 * confirm them before real use.
 */
import { doseWindowDays, isWindowClosed, type DoseInput } from './schedule.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const EARLY_GRACE_DAYS = 4;
export const SERIES_MIN_INTERVAL_DAYS = 28;

export interface Eligibility {
  /** The earliest date this dose can be given, or null if the previous dose isn't given yet. */
  eligibleFrom: Date | null;
  /** Why it can't be given yet, in plain words; null when it can. */
  reason: string | null;
  /** Past the age it can be given at: not needed any more. */
  closed?: boolean;
}

function windowText(days: number): string {
  if (days % 365 === 0) return days === 365 ? 'first year' : `first ${days / 365} years`;
  if (days % 7 === 0) return days === 7 ? 'first week' : `first ${days / 7} weeks`;
  return `first ${days} days`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function doseEligibility(doses: DoseInput[], dose: DoseInput, now: Date = new Date()): Eligibility {
  if (isWindowClosed(dose, now)) {
    const w = doseWindowDays(dose) ?? 0;
    return { eligibleFrom: null, reason: `Only given in the ${windowText(w)} of life, so it's no longer needed.`, closed: true };
  }
  const byAge = new Date(dose.dueDate.getTime() - EARLY_GRACE_DAYS * DAY_MS);
  let from = byAge;

  if (dose.doseNumber > 1) {
    const prev = doses.find((d) => d.vaccineCode === dose.vaccineCode && d.doseNumber === dose.doseNumber - 1);
    if (prev && !prev.administeredDate) {
      return { eligibleFrom: null, reason: `Give dose ${prev.doseNumber} first; this one follows at least 4 weeks later.` };
    }
    if (prev?.administeredDate) {
      const byInterval = new Date(prev.administeredDate.getTime() + SERIES_MIN_INTERVAL_DAYS * DAY_MS);
      if (byInterval > from) from = byInterval;
    }
  }

  if (startOfDay(now) < startOfDay(from)) {
    const fromText = from.toISOString().slice(0, 10);
    const tooSoonAfterPrev = from !== byAge;
    return {
      eligibleFrom: from,
      reason: tooSoonAfterPrev
        ? `Too soon after dose ${dose.doseNumber - 1}: it needs at least 4 weeks. Can be given from ${fromText}.`
        : `Too early for the child's age. Can be given from ${fromText}.`
    };
  }
  return { eligibleFrom: from, reason: null };
}

export interface ParentDose extends DoseInput {
  /** The date the family can actually bring the child for this dose. */
  comeDate: Date;
  /** Waiting on an earlier dose in its series that hasn't been given yet. */
  waitingOnEarlier: boolean;
  /** Past the age it can be given at: not something to come in for. */
  windowClosed: boolean;
}

/**
 * What parents are told. A late child's schedule shifts: once dose 1 is given,
 * dose 2 is 4 weeks after it, not on its original (long past) date, and a dose
 * still waiting on an earlier one isn't something to come in for on its own.
 * Staff and the dashboard keep the original schedule, where a late child is
 * rightly shown as behind.
 */
export function parentSchedule(doses: DoseInput[], now: Date = new Date()): ParentDose[] {
  const come = new Map<string, Date>();
  const key = (d: Pick<DoseInput, 'vaccineCode' | 'doseNumber'>) => `${d.vaccineCode}#${d.doseNumber}`;
  const ordered = [...doses].sort((a, b) => a.vaccineCode.localeCompare(b.vaccineCode) || a.doseNumber - b.doseNumber);
  const out = new Map<string, ParentDose>();

  for (const d of ordered) {
    let date = d.dueDate;
    let waiting = false;
    if (d.doseNumber > 1) {
      const prev = doses.find((p) => p.vaccineCode === d.vaccineCode && p.doseNumber === d.doseNumber - 1);
      if (prev) {
        const prevDate = prev.administeredDate ?? come.get(key(prev)) ?? prev.dueDate;
        waiting = !prev.administeredDate;
        const byInterval = new Date(prevDate.getTime() + SERIES_MIN_INTERVAL_DAYS * DAY_MS);
        if (byInterval > date) date = byInterval;
      }
    }
    come.set(key(d), date);
    out.set(key(d), {
      ...d,
      comeDate: date,
      waitingOnEarlier: waiting && !d.administeredDate,
      windowClosed: isWindowClosed(d, now)
    });
  }
  // Back in the caller's order.
  return doses.map((d) => out.get(key(d)) as ParentDose);
}

/** The same doses with each outstanding due date moved to when the family can come. */
export function asParentDoses(doses: DoseInput[], now: Date = new Date()): DoseInput[] {
  return parentSchedule(doses, now).map((d) => ({
    vaccineCode: d.vaccineCode,
    displayName: d.displayName,
    doseNumber: d.doseNumber,
    dueDate: d.administeredDate ? d.dueDate : d.comeDate,
    administeredDate: d.administeredDate
  }));
}
