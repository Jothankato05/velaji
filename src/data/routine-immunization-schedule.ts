/**
 * Nigeria's routine childhood immunization schedule, as commonly published by
 * the National Primary Health Care Development Agency (NPHCDA).
 *
 * Reflects two changes confirmed from current national sources (2025/26):
 *   - Hepatitis B is given as a monovalent birth dose (HepB0), separate from the
 *     HepB in the pentavalent series.
 *   - The measles-containing 1st/2nd doses are now the Measles–Rubella (MR)
 *     vaccine, which NPHCDA introduced into routine immunization in the 2025/26
 *     integrated campaign (replacing measles-only).
 *
 * Documented current additions NOT yet wired into this routine template (they
 * change dose counts and cadence and need clinical sign-off first): the malaria
 * vaccine R21/Matrix-M (rolling out, ~5/6/7-month primary series + booster) and
 * HPV for 9-year-old girls. Vitamin A and Meningitis-A timing also vary by the
 * current NPHCDA revision (often 9 months / 12–24 months) — verify before use.
 *
 * IMPORTANT: this is reference data for a software prototype, not a clinical
 * source. Before this touches a real child's care, a health authority must
 * verify it against the current NPHCDA/WHO schedule.
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
  { vaccineCode: 'HEPB', displayName: 'Hepatitis B (birth dose)', doseNumber: 0, dueOffsetDays: 0 },

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

  { vaccineCode: 'MR', displayName: 'Measles–Rubella (MR)', doseNumber: 1, dueOffsetDays: 9 * MONTH },
  { vaccineCode: 'YF', displayName: 'Yellow Fever', doseNumber: 1, dueOffsetDays: 9 * MONTH },
  { vaccineCode: 'MENA', displayName: 'Meningitis A', doseNumber: 1, dueOffsetDays: 9 * MONTH },
  { vaccineCode: 'VITA', displayName: 'Vitamin A (1st dose)', doseNumber: 1, dueOffsetDays: 9 * MONTH },

  { vaccineCode: 'MR', displayName: 'Measles–Rubella (MR)', doseNumber: 2, dueOffsetDays: 15 * MONTH }
];

export function totalDosesInSchedule(): number {
  return ROUTINE_IMMUNIZATION_SCHEDULE.length;
}
