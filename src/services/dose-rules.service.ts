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
import type { DoseInput } from './schedule.service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const EARLY_GRACE_DAYS = 4;
export const SERIES_MIN_INTERVAL_DAYS = 28;

export interface Eligibility {
  /** The earliest date this dose can be given, or null if the previous dose isn't given yet. */
  eligibleFrom: Date | null;
  /** Why it can't be given yet, in plain words; null when it can. */
  reason: string | null;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function doseEligibility(doses: DoseInput[], dose: DoseInput, now: Date = new Date()): Eligibility {
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
