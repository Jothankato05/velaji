/**
 * Nigeria's routine childhood immunization schedule, as commonly published by
 * the National Primary Health Care Development Agency (NPHCDA).
 *
 * IMPORTANT: this is reference data for a software prototype, not a clinical
 * source. Before this touches a real child's care, a health authority must
 * verify it against current NPHCDA/WHO guidance — schedules are revised
 * (e.g. new antigens, dose-interval changes) and this file will go stale.
 */

export interface ScheduleTemplateEntry {
  vaccineCode: string;
  displayName: string;
  doseNumber: number;
  /** Age at which this dose is due, in days from date of birth. */
  dueOffsetDays: number;
}

const WEEK = 7;
const MONTH = 30;

export const ROUTINE_IMMUNIZATION_SCHEDULE: ScheduleTemplateEntry[] = [
  { vaccineCode: 'BCG', displayName: 'BCG (Tuberculosis)', doseNumber: 1, dueOffsetDays: 0 },
  { vaccineCode: 'OPV', displayName: 'Oral Polio Vaccine', doseNumber: 0, dueOffsetDays: 0 },

  { vaccineCode: 'PENTA', displayName: 'Pentavalent (DPT-HepB-Hib)', doseNumber: 1, dueOffsetDays: 6 * WEEK },
  { vaccineCode: 'OPV', displayName: 'Oral Polio Vaccine', doseNumber: 1, dueOffsetDays: 6 * WEEK },
  { vaccineCode: 'PCV', displayName: 'Pneumococcal Conjugate Vaccine', doseNumber: 1, dueOffsetDays: 6 * WEEK },
  { vaccineCode: 'ROTA', displayName: 'Rotavirus Vaccine', doseNumber: 1, dueOffsetDays: 6 * WEEK },

  { vaccineCode: 'PENTA', displayName: 'Pentavalent (DPT-HepB-Hib)', doseNumber: 2, dueOffsetDays: 10 * WEEK },
  { vaccineCode: 'OPV', displayName: 'Oral Polio Vaccine', doseNumber: 2, dueOffsetDays: 10 * WEEK },
  { vaccineCode: 'PCV', displayName: 'Pneumococcal Conjugate Vaccine', doseNumber: 2, dueOffsetDays: 10 * WEEK },
  { vaccineCode: 'ROTA', displayName: 'Rotavirus Vaccine', doseNumber: 2, dueOffsetDays: 10 * WEEK },

  { vaccineCode: 'PENTA', displayName: 'Pentavalent (DPT-HepB-Hib)', doseNumber: 3, dueOffsetDays: 14 * WEEK },
  { vaccineCode: 'OPV', displayName: 'Oral Polio Vaccine', doseNumber: 3, dueOffsetDays: 14 * WEEK },
  { vaccineCode: 'PCV', displayName: 'Pneumococcal Conjugate Vaccine', doseNumber: 3, dueOffsetDays: 14 * WEEK },
  { vaccineCode: 'IPV', displayName: 'Inactivated Polio Vaccine', doseNumber: 1, dueOffsetDays: 14 * WEEK },

  { vaccineCode: 'MEASLES', displayName: 'Measles', doseNumber: 1, dueOffsetDays: 9 * MONTH },
  { vaccineCode: 'YF', displayName: 'Yellow Fever', doseNumber: 1, dueOffsetDays: 9 * MONTH },
  { vaccineCode: 'MENA', displayName: 'Meningitis A', doseNumber: 1, dueOffsetDays: 9 * MONTH },
  { vaccineCode: 'VITA', displayName: 'Vitamin A (1st dose)', doseNumber: 1, dueOffsetDays: 9 * MONTH },

  { vaccineCode: 'MEASLES', displayName: 'Measles', doseNumber: 2, dueOffsetDays: 15 * MONTH }
];

export function totalDosesInSchedule(): number {
  return ROUTINE_IMMUNIZATION_SCHEDULE.length;
}
