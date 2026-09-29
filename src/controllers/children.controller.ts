import type { Request, Response } from 'express';
import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { CertificateModel } from '../models/Certificate';
import { FacilityHandoffModel } from '../models/FacilityHandoff';
import { generateChin, normalizeChin } from '../services/chin.service';
import { buildDosesForChild, computeChildStatus, isScheduleComplete, isWindowClosed } from '../services/schedule.service';
import { generatePrintableCardSvg } from '../services/card.service';
import { maybeIssueCertificate } from '../services/certificate.service';
import { autoResolveForDose } from '../services/escalation.service';
import { recordAdministration } from '../services/fraud.service';
import { addHealthRecord, getHealthRecords, isHealthDomain } from '../services/wallet.service';
import { referForRegistration, recordRegistration } from '../services/birth-registration.service';
import { childToFhirBundle } from '../services/fhir.service';
import { AppError } from '../utils/AppError';
import { searchChildren } from '../services/child-search.service';
import { doseEligibility } from '../services/dose-rules.service';
import { phoneKey, phoneMatchSource } from '../utils/phone';

async function findChildOr404(chinParam: string | string[]) {
  const chin = normalizeChin(Array.isArray(chinParam) ? chinParam[0] : chinParam);
  const child = await ChildModel.findOne({ chin });
  if (!child) throw new AppError(`No child found with CHIN ${chin}`, 404);
  return child;
}

function toChildView(child: Awaited<ReturnType<typeof findChildOr404>>) {
  return {
    chin: child.chin,
    fullName: child.fullName,
    sex: child.sex,
    dateOfBirth: child.dateOfBirth,
    caregiverId: child.caregiverId,
    homeFacilityId: child.homeFacilityId,
    currentFacilityId: child.currentFacilityId,
    status: computeChildStatus(
      // Explicit field access, not `{...d}` — spreading a Mongoose subdocument
      // does not reliably carry its schema fields onto the plain object.
      child.doses.map((d) => ({
        vaccineCode: d.vaccineCode,
        displayName: d.displayName,
        doseNumber: d.doseNumber,
        dueDate: d.dueDate,
        administeredDate: d.administeredDate ?? null
      })),
      { needsReconciliation: child.needsReconciliation }
    ),
    doses: child.doses,
    completedAt: child.completedAt
  };
}

const BIRTH_SETTINGS = ['facility', 'home', 'other'];
const REGISTRATION_CHANNELS = ['phc', 'hospital', 'chw', 'mobile_team', 'outreach', 'npc', 'antenatal'];

/** Velaji follows children under five. */
const MAX_AGE_YEARS = 5;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function registerChild(req: Request, res: Response) {
  const { fullName, sex, dateOfBirth, caregiverId, caregiver: newCaregiver, homeFacilityId, birthSetting, registrationChannel } = req.body ?? {};
  // The caregiver is either an existing record (caregiverId) or given inline
  // ({ fullName, phone }) and only created once every check below has passed,
  // so a rejected registration doesn't leave an orphan caregiver behind.
  if (!fullName || !sex || !dateOfBirth || (!caregiverId && !newCaregiver) || !homeFacilityId) {
    throw new AppError('fullName, sex, dateOfBirth, homeFacilityId and a caregiver (caregiverId, or caregiver with fullName and phone) are required');
  }
  if (newCaregiver && (!String(newCaregiver.fullName ?? '').trim() || phoneKey(String(newCaregiver.phone ?? '')).length < 10)) {
    throw new AppError("The parent or guardian's name and a full phone number are required.");
  }
  // §19: home births and non-PHC channels are first-class. Default to the
  // facility path when unspecified, but never reject a home birth.
  const setting = birthSetting && BIRTH_SETTINGS.includes(birthSetting) ? birthSetting : 'facility';
  const channel = registrationChannel && REGISTRATION_CHANNELS.includes(registrationChannel) ? registrationChannel : 'phc';
  const tidy = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ');
  const name = tidy(fullName);

  const [caregiver, facility] = await Promise.all([
    caregiverId ? CaregiverModel.findById(caregiverId) : Promise.resolve(null),
    FacilityModel.findById(homeFacilityId)
  ]);
  if (caregiverId && !caregiver) throw new AppError('caregiverId does not match a known caregiver', 404);
  if (!facility) throw new AppError('homeFacilityId does not match a known facility', 404);

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) throw new AppError('dateOfBirth is not a valid date');
  // A day's grace either way of "today" covers time zones.
  const DAY = 24 * 60 * 60 * 1000;
  if (dob.getTime() > Date.now() + DAY) throw new AppError("The date of birth can't be in the future.");
  const oldest = new Date();
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);
  if (dob.getTime() < oldest.getTime() - DAY) {
    throw new AppError(`Velaji registers children under ${MAX_AGE_YEARS}; this date of birth is more than ${MAX_AGE_YEARS} years ago.`);
  }

  // The same child registered twice splits their record across two CHINs.
  // Same name, same date of birth and the same caregiver phone is that child.
  const phoneRegex = phoneMatchSource(String(newCaregiver?.phone ?? caregiver?.phone ?? ''));
  if (phoneRegex) {
    const carers = await CaregiverModel.find({ phone: { $regex: phoneRegex } }, { _id: 1 });
    const dayStart = new Date(Date.UTC(dob.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate()));
    const existing = carers.length
      ? await ChildModel.findOne({
          caregiverId: { $in: carers.map((c) => c._id) },
          fullName: { $regex: `^\\s*${escapeRegex(name).replace(/ /g, '\\s+')}\\s*$`, $options: 'i' },
          dateOfBirth: { $gte: new Date(dayStart.getTime() - DAY), $lt: new Date(dayStart.getTime() + 2 * DAY) }
        })
      : null;
    if (existing) {
      res.status(409).json({
        error: `${existing.fullName} is already registered with this date of birth and phone number (CHIN ${existing.chin}). Open that record instead of creating a second one.`,
        existingChin: existing.chin
      });
      return;
    }
  }

  const carer = caregiver ?? (await CaregiverModel.create({
    fullName: tidy(newCaregiver.fullName),
    phone: String(newCaregiver.phone).trim(),
    relationship: newCaregiver.relationship
  }));

  // Astronomically unlikely to collide (8 base32 chars = 40 bits of entropy)
  // but a health ID system doesn't get to shrug at "unlikely" — retry on the
  // rare unique-index conflict instead of trusting randomness blindly.
  let chin = generateChin();
  for (let attempt = 0; attempt < 5 && (await ChildModel.exists({ chin })); attempt++) {
    chin = generateChin();
  }

  const child = await ChildModel.create({
    chin,
    fullName: name,
    sex,
    dateOfBirth: dob,
    caregiverId: carer._id,
    homeFacilityId,
    currentFacilityId: homeFacilityId,
    birthSetting: setting,
    registrationChannel: channel,
    doses: buildDosesForChild(dob)
  });

  res.status(201).json(toChildView(child));
}

/** Find a child by part of the CHIN, a name, or the caregiver's phone. */
export async function getChildSearch(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json(await searchChildren(q));
}

export async function getChild(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  res.json(toChildView(child));
}

export async function recordDose(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const { vaccineCode, doseNumber, administeredAt, facilityId } = req.body ?? {};
  if (!vaccineCode || doseNumber === undefined || !facilityId) {
    throw new AppError('vaccineCode, doseNumber, facilityId are required');
  }

  const dose = child.doses.find((d) => d.vaccineCode === vaccineCode && d.doseNumber === Number(doseNumber));
  if (!dose) throw new AppError(`No scheduled dose ${vaccineCode} #${doseNumber} for this child`, 404);

  const actor = { recordedBy: req.user?.username ?? 'unknown', recordedByRole: (req.user?.role ?? 'system') as 'verifier' | 'staff' | 'admin' | 'system' };

  // NCIHAP §17 duplicate-dose detection: a dose already given must not be
  // silently re-recorded (double claims). Log the attempt to the fraud ledger
  // and refuse it.
  if (dose.administeredDate) {
    await recordAdministration({ chin: child.chin, childId: child._id, vaccineCode, doseNumber: Number(doseNumber), facilityId, ...actor, duplicate: true }).catch(() => {});
    throw new AppError(`This dose was already recorded on ${dose.administeredDate.toISOString().slice(0, 10)}.`, 409);
  }

  // Refuse a dose that wouldn't count: too young, or too soon after (or
  // before) the previous dose in its series.
  const givenAt = administeredAt ? new Date(administeredAt) : new Date();
  if (Number.isNaN(givenAt.getTime()) || givenAt.getTime() > Date.now() + 60 * 60 * 1000) {
    throw new AppError('The date given must be today or earlier.', 422);
  }
  const asInputs = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber,
    dueDate: d.dueDate, administeredDate: d.administeredDate ?? null
  }));
  const target = asInputs.find((d) => d.vaccineCode === vaccineCode && d.doseNumber === Number(doseNumber));
  const eligibility = target ? doseEligibility(asInputs, target, givenAt) : null;
  if (eligibility?.reason) {
    throw new AppError(`${dose.displayName}, dose ${dose.doseNumber}: ${eligibility.reason}`, 422);
  }

  dose.administeredDate = givenAt;
  dose.administeredAtFacilityId = facilityId;
  // §17 audit: every genuine administration is written to an append-only ledger.
  await recordAdministration({ chin: child.chin, childId: child._id, vaccineCode, doseNumber: Number(doseNumber), facilityId, ...actor }).catch(() => {});

  // Complete when every dose is given or past the age it's given at.
  const complete = isScheduleComplete(child.doses.map((d) => ({
    vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber,
    dueDate: d.dueDate, administeredDate: d.administeredDate ?? null
  })));
  if (complete && !child.completedAt) {
    child.completedAt = new Date();
  }

  await child.save();
  await maybeIssueCertificate(child);
  // Recording the dose removes the reason any escalation for it was raised.
  await autoResolveForDose(child._id, `${vaccineCode}#${Number(doseNumber)}`);

  res.json(toChildView(child));
}

export async function getCard(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const [facility, caregiver] = await Promise.all([
    FacilityModel.findById(child.homeFacilityId),
    CaregiverModel.findById(child.caregiverId)
  ]);
  const svg = await generatePrintableCardSvg({
    chin: child.chin,
    fullName: child.fullName,
    sex: child.sex,
    dateOfBirth: child.dateOfBirth,
    facilityName: facility?.name ?? 'Unknown facility',
    caregiverName: caregiver?.fullName,
    caregiverPhone: caregiver?.phone || undefined
  });

  res.type('image/svg+xml').send(svg);
}

export async function getCertificate(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const certificate = await CertificateModel.findOne({ childId: child._id });
  if (!certificate) throw new AppError('No certificate issued yet; the schedule is not complete', 404);
  res.json(certificate);
}

/**
 * The whole story of one child in a single call, for the card-driven point-of-
 * care experience: who they are, the ONE vaccine that's next (the system
 * remembers so the caregiver doesn't), progress toward the finish, and — once
 * complete — the unlocked NHIA "Healthy Start" coverage. This is what the card
 * "carries the brain" so the family doesn't have to.
 */
export async function getJourney(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const doses = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode,
    displayName: d.displayName,
    doseNumber: d.doseNumber,
    dueDate: d.dueDate,
    administeredDate: d.administeredDate ?? null
  }));

  // Doses past the age they're given at no longer count toward the total.
  const applicable = doses.filter((d) => !isWindowClosed(d));
  const administered = applicable.filter((d) => d.administeredDate).length;
  const next = applicable
    .filter((d) => !d.administeredDate)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  const facility = await FacilityModel.findById(child.currentFacilityId);
  const caregiver = await CaregiverModel.findById(child.caregiverId);
  const certificate = await CertificateModel.findOne({ childId: child._id });

  res.json({
    chin: child.chin,
    fullName: child.fullName,
    sex: child.sex,
    dateOfBirth: child.dateOfBirth,
    status: computeChildStatus(doses, { needsReconciliation: child.needsReconciliation }),
    currentFacility: facility?.name ?? null,
    caregiver: caregiver ? { fullName: caregiver.fullName, phone: caregiver.phone || null } : null,
    progress: { administered, total: applicable.length, remaining: applicable.length - administered },
    nextDue: next
      ? { vaccine: next.displayName, vaccineCode: next.vaccineCode, doseNumber: next.doseNumber, dueDate: next.dueDate }
      : null,
    completedAt: child.completedAt ?? null,
    eligibility: Object.fromEntries(
      doses
        .filter((d) => !d.administeredDate)
        .map((d) => [`${d.vaccineCode}#${d.doseNumber}`, doseEligibility(doses, d)])
    ),
    coverage: certificate
      ? {
          programme: certificate.coverageProgramme,
          months: certificate.coverageMonths,
          startsAt: certificate.coverageStartsAt,
          expiresAt: certificate.coverageExpiresAt,
          active: (certificate.coverageExpiresAt?.getTime() ?? 0) > Date.now(),
          nhiaIntegrationStatus: certificate.nhiaIntegrationStatus
        }
      : null,
    doses
  });
}

/** Child Health Wallet (NCIHAP §21): the child's non-immunisation health
 *  records — growth, Vitamin A, nutrition, development, referrals, labs, … */
export async function getWallet(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  res.json({ chin: child.chin, records: await getHealthRecords(child.chin) });
}

export async function addWalletRecord(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const { domain, title, value, note, facilityId } = req.body ?? {};
  if (!isHealthDomain(domain)) throw new AppError('domain must be a recognised health-wallet domain');
  if (!title || !value) throw new AppError('title and value are required');

  const record = await addHealthRecord(
    child,
    { domain, title: String(title), value: String(value), note: note ? String(note) : undefined, facilityId },
    { username: req.user?.username ?? 'unknown', role: req.user?.role ?? 'system' }
  );
  res.status(201).json(record);
}

export async function recordHandoff(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const { toFacilityId, lat, lng, reason, reasonCategory } = req.body ?? {};
  if (!toFacilityId || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new AppError('toFacilityId, lat, lng are required');
  }

  const toFacility = await FacilityModel.findById(toFacilityId);
  if (!toFacility) throw new AppError('toFacilityId does not match a known facility', 404);

  const MOBILITY = ['relocation', 'displacement', 'nomadic', 'migration', 'outreach', 'other'];
  const category = reasonCategory && MOBILITY.includes(reasonCategory) ? reasonCategory : 'relocation';

  const handoff = await FacilityHandoffModel.create({
    childId: child._id,
    fromFacilityId: child.currentFacilityId,
    toFacilityId,
    reportedLocation: { lat, lng },
    reason: reason ?? '',
    reasonCategory: category,
    handoffAt: new Date()
  });

  child.currentFacilityId = toFacilityId;
  await child.save();

  res.status(201).json(handoff);
}

/**
 * §4 civil registration: hand this child to NPC for birth registration, then
 * carry the numbers back when they are issued. Velaji does not register births;
 * it knows the child exists and refers her.
 */
export async function postReferBirthRegistration(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  res.json(await referForRegistration(child.chin));
}

export async function postBirthRegistration(req: Request, res: Response) {
  const { registrationNumber, nin } = req.body ?? {};
  const child = await findChildOr404(req.params.chin);
  res.json(await recordRegistration(child.chin, { registrationNumber, nin }));
}

/**
 * §22 interoperability: this child as a FHIR R4 Bundle, shaped to the NPHCDA
 * Immunization IG — Patient, the doses given, and (the part EMID does not hold)
 * what is still due and when.
 */
export async function getChildFhir(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const facility = await FacilityModel.findById(child.currentFacilityId);
  const bundle = childToFhirBundle({
    chin: child.chin,
    fullName: child.fullName,
    sex: child.sex,
    dateOfBirth: child.dateOfBirth,
    doses: child.doses.map((d) => ({
      vaccineCode: d.vaccineCode,
      displayName: d.displayName,
      doseNumber: d.doseNumber,
      dueDate: d.dueDate,
      administeredDate: d.administeredDate ?? null
    })),
    birthRegistration: {
      registrationNumber: child.birthRegistration?.registrationNumber || undefined,
      nin: child.birthRegistration?.nin || undefined
    },
    facilityName: facility?.name
  });
  res.type('application/fhir+json').json(bundle);
}
