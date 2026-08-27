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
 * change dose counts and cadence and need clinical sign-off first):
 *
 *   - **R21/Matrix-M malaria vaccine** (WHO-prequalified Dec 2023, manufactured
 *     by Serum Institute of India, stored +2–8°C). Nigeria began phased rollout
 *     in Kebbi + Bayelsa Dec 2024. Schedule: 4 doses — dose 1 at ~5 months,
 *     doses 2 & 3 at minimum 4-week intervals, dose 4 ≥12 months after dose 3.
 *     An optional 5th dose 1 year after dose 4 in high-seasonality areas. 0.5 mL
 *     IM per dose, single-dose vial (50 vials/carton).
 *
 *   - **HPV (Gardasil-4)** single-dose for girls aged 9–14. NAFDAC approved
 *     single-dose schedule; NPHCDA launched phase 1 across 16 states Oct 2023,
 *     phase 2 (remaining states) May 2024. Transitioning from campaign to routine
 *     immunization (9-year-old girls only) from 2025. ~71% of 9–14 cohort
 *     vaccinated by mid-2025.
 *
 *   - Vitamin A and Meningitis-A timing also vary by the current NPHCDA revision
 *     (often 9 months / 12–24 months) — verify before use.
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

/**
 * Packed cold-chain volume per dose (cm³), by vaccine code — the space one dose
 * occupies in a cold room/fridge including primary + secondary packaging. Figures
 * are from WHO EPI logistics guidance and the Niger supply-chain study (commonly
 * cited WHO/AFRO reference):
 *
 *   BCG   (20-dose vial):          ~0.9 cm³/dose
 *   bOPV  (20-dose vial):          ~1.0 cm³/dose (oral drops, compact)
 *   HepB0 (monovalent, 10-dose):   ~3.0 cm³/dose
 *   Penta (10-dose):               ~3.1 cm³/dose
 *   PCV   (single/2-dose):         ~2.1 cm³/dose
 *   Rota  (Rotavac 5C, 5-dose):    ~3.5 cm³/dose (Rotarix single-tube is ~17;
 *                                   Rotavac is the compact option deployed)
 *   IPV   (10-dose):               ~2.4 cm³/dose
 *   MR    (10-dose + diluent):     ~5.2 cm³/dose (vaccine 2.1 + diluent 3.1)
 *   YF    (10-dose + diluent):     ~2.7 cm³/dose
 *   MenA  (10-dose):               ~2.1 cm³/dose
 *   VitA  (supplement):             0   (room-temperature capsule, not cold-chain)
 *
 * R21/Matrix-M (single-dose vial + Matrix-M adjuvant): ~6.5 cm³/dose (estimate
 * from the 50-vial carton geometry; exact WHO PQ product spec TBC).
 * HPV/Gardasil-4 (single-dose prefilled syringe): ~7.0 cm³/dose (typical
 * single-dose prefilled syringe + carton).
 *
 * IMPORTANT: these are planning estimates for a prototype, not definitive product
 * specs. Verify against the WHO prequalified vaccine database or the specific
 * product in use before operational planning.
 */
export const COLD_CHAIN_CM3_PER_DOSE: Record<string, number> = {
  BCG:   0.9,
  OPV:   1.0,
  HEPB:  3.0,
  PENTA: 3.1,
  PCV:   2.1,
  ROTA:  3.5,
  IPV:   2.4,
  MR:    5.2,
  YF:    2.7,
  MENA:  2.1,
  VITA:  0,    // room-temperature supplement, no cold-chain demand
  // Pending antigens (not yet in the routine template)
  MAL:   6.5,  // R21/Matrix-M malaria
  HPV:   7.0,  // Gardasil-4 single-dose syringe
};

/** Default cold-chain volume for an antigen not in the map. */
export const COLD_CHAIN_CM3_DEFAULT = 3.0;

/**
 * Look up the packed cold-chain volume (cm³) for one dose of a vaccine.
 * Returns 0 for room-temperature supplements (Vitamin A).
 */
export function coldChainCm3(vaccineCode: string): number {
  return COLD_CHAIN_CM3_PER_DOSE[vaccineCode] ?? COLD_CHAIN_CM3_DEFAULT;
}

/**
 * Antigens confirmed for Nigeria's expanded schedule but not yet wired into the
 * routine template (need clinical sign-off before they change dose counts):
 *
 * R21/Matrix-M (malaria):
 *   - WHO-prequalified Dec 2023; Serum Institute of India; stored +2–8°C
 *   - Schedule: 4 doses — dose 1 at ~5 mo, dose 2 & 3 at ≥4-week intervals,
 *     dose 4 at ≥12 mo after dose 3. Optional 5th dose 1 yr after dose 4 in
 *     highly seasonal areas. 0.5 mL IM. Single-dose vial.
 *   - Nigeria rollout: Kebbi + Bayelsa from Dec 2024. ~206k dose-1 in Kebbi
 *     by Dec 2025. Integrated into routine immunization.
 *
 * HPV (Gardasil-4):
 *   - NAFDAC approved single-dose schedule for girls 9–14
 *   - Phase 1: 16 states Oct 2023; Phase 2: remaining states May 2024
 *   - Transitioning to routine (9-yr-old girls only) from 2025
 *   - ~4.7 M girls vaccinated in phase 1; ~71% of 9–14 cohort by mid-2025
 */
export const PENDING_ANTIGENS = [
  {
    code: 'MAL',
    name: 'R21/Matrix-M (Malaria)',
    dosesInSeries: 4,
    schedule: 'Dose 1 at ~5 months; doses 2–3 at ≥4-week intervals; dose 4 ≥12 months after dose 3',
    storage: '+2–8°C',
    route: 'IM 0.5 mL',
    nigeriaStatus: 'Rolling out in Kebbi + Bayelsa (Dec 2024)',
  },
  {
    code: 'HPV',
    name: 'HPV (Gardasil-4)',
    dosesInSeries: 1,
    schedule: 'Single dose at age 9 (girls)',
    storage: '+2–8°C',
    route: 'IM 0.5 mL',
    nigeriaStatus: 'NAFDAC single-dose approved; 37 states rolled out; transitioning to routine 2025',
  },
] as const;
