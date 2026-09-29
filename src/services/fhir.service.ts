import { computeDoseStatus, isWindowClosed } from './schedule.service';

/**
 * FHIR R4 export (NCIHAP §4 / §22 interoperability).
 *
 * Nigeria already runs EMID for immunisation data, and NPHCDA publishes an
 * Immunization FHIR Implementation Guide. The strategic position is to build TO
 * that, not around it: EMID keeps the national record, and Velaji contributes
 * the two things it has that a reporting system does not — a child identified
 * across facilities, and the schedule of what that child is owed NEXT.
 *
 * That second resource is the point. An ImmunizationRecommendation is not a
 * report of what happened; it is a statement of what is due and when, per child.
 * Exporting it is what makes Velaji worth integrating rather than duplicating.
 *
 * Honest seam: this produces a conformant Bundle for an integrator to POST. It
 * does not talk to EMID — no endpoint, no credentials, no negotiated profile.
 * Wiring that is a deployment task with NPHCDA, not something a prototype can
 * assert. Profile URLs below are the published IG's canonical base.
 */

const IG = 'https://build.fhir.org/ig/Nigeria-FHIR-Community/NPHCDA-ImmunizationIG';
const SYS_CHIN = 'http://nphcda.gov.ng/identifier/chin';
const SYS_NIN = 'http://nimc.gov.ng/identifier/nin';
const SYS_BRN = 'http://nationalpopulation.gov.ng/identifier/birth-registration';
const SYS_VACCINE = 'http://nphcda.gov.ng/CodeSystem/vaccine-code';

export interface FhirChildInput {
  chin: string;
  fullName: string;
  sex: string;
  dateOfBirth: Date;
  doses: Array<{
    vaccineCode: string;
    displayName: string;
    doseNumber: number;
    dueDate: Date;
    administeredDate: Date | null;
  }>;
  birthRegistration?: { registrationNumber?: string; nin?: string };
  facilityName?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a FHIR R4 collection Bundle for one child:
 *   Patient                     — who, identified by CHIN (+ NIN / birth reg number)
 *   Immunization[]              — doses actually given
 *   ImmunizationRecommendation  — what is still due, and when
 */
export function childToFhirBundle(child: FhirChildInput, now: Date = new Date()) {
  const patientId = `chin-${child.chin.replace(/[^A-Za-z0-9]/g, '')}`;
  const patientRef = { reference: `Patient/${patientId}` };

  const identifier: Array<Record<string, unknown>> = [
    { system: SYS_CHIN, value: child.chin, use: 'usual' }
  ];
  // Present only once civil registration has actually happened — the absence of
  // these is itself the finding this system exists to surface.
  if (child.birthRegistration?.registrationNumber) {
    identifier.push({ system: SYS_BRN, value: child.birthRegistration.registrationNumber, use: 'official' });
  }
  if (child.birthRegistration?.nin) {
    identifier.push({ system: SYS_NIN, value: child.birthRegistration.nin, use: 'official' });
  }

  const patient = {
    resourceType: 'Patient',
    id: patientId,
    meta: { profile: [`${IG}/StructureDefinition/nphcda-patient`] },
    identifier,
    name: [{ text: child.fullName }],
    gender: child.sex === 'male' || child.sex === 'female' ? child.sex : 'unknown',
    birthDate: isoDate(child.dateOfBirth)
  };

  // Pair each given dose with its date so the date stays non-null below.
  const given = child.doses.flatMap((d) => (d.administeredDate ? [{ d, at: d.administeredDate }] : []));
  const immunizations = given.map(({ d, at }, i) => ({
    resourceType: 'Immunization',
    id: `${patientId}-imm-${i + 1}`,
    meta: { profile: [`${IG}/StructureDefinition/nphcda-immunization`] },
    status: 'completed',
    vaccineCode: { coding: [{ system: SYS_VACCINE, code: d.vaccineCode, display: d.displayName }], text: d.displayName },
    patient: patientRef,
    occurrenceDateTime: at.toISOString(),
    primarySource: true,
    protocolApplied: [{ doseNumberPositiveInt: d.doseNumber }],
    ...(child.facilityName ? { location: { display: child.facilityName } } : {})
  }));

  // Doses past the age they're given at aren't recommended any more.
  const outstanding = child.doses.filter((d) => !d.administeredDate && !isWindowClosed({ ...d, administeredDate: null }, now));
  const recommendation = outstanding.length
    ? [{
        resourceType: 'ImmunizationRecommendation',
        id: `${patientId}-rec`,
        meta: { profile: [`${IG}/StructureDefinition/nphcda-immunization-recommendation`] },
        patient: patientRef,
        date: now.toISOString(),
        recommendation: outstanding.map((d) => ({
          vaccineCode: [{ coding: [{ system: SYS_VACCINE, code: d.vaccineCode, display: d.displayName }] }],
          // Velaji's five-colour status maps onto FHIR's recommendation status:
          // an overdue dose is 'due', one still in its window is 'safe-to-give'.
          forecastStatus: {
            text: computeDoseStatus(d.dueDate, now) === 'RED' ? 'overdue' : 'due',
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/immunization-recommendation-status',
              code: computeDoseStatus(d.dueDate, now) === 'RED' ? 'due' : 'safe-to-give'
            }]
          },
          doseNumberPositiveInt: d.doseNumber,
          dateCriterion: [{
            code: { coding: [{ system: 'http://loinc.org', code: '30980-7', display: 'Date vaccine due' }] },
            value: d.dueDate.toISOString()
          }]
        }))
      }]
    : [];

  const entries = [patient, ...immunizations, ...recommendation];

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: now.toISOString(),
    total: entries.length,
    entry: entries.map((resource) => ({ resource }))
  };
}
