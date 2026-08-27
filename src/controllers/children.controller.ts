import type { Request, Response } from 'express';
import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { CertificateModel } from '../models/Certificate';
import { FacilityHandoffModel } from '../models/FacilityHandoff';
import { generateChin, normalizeChin } from '../services/chin.service';
import { buildDosesForChild, computeChildStatus } from '../services/schedule.service';
import { generatePrintableCardSvg } from '../services/card.service';
import { maybeIssueCertificate } from '../services/certificate.service';
import { autoResolveForDose } from '../services/escalation.service';
import { recordAdministration } from '../services/fraud.service';
import { addHealthRecord, getHealthRecords, isHealthDomain } from '../services/wallet.service';
import { AppError } from '../utils/AppError';

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
const REGISTRATION_CHANNELS = ['phc', 'hospital', 'chw', 'mobile_team', 'outreach', 'npc'];

export async function registerChild(req: Request, res: Response) {
  const { fullName, sex, dateOfBirth, caregiverId, homeFacilityId, birthSetting, registrationChannel } = req.body ?? {};
  if (!fullName || !sex || !dateOfBirth || !caregiverId || !homeFacilityId) {
    throw new AppError('fullName, sex, dateOfBirth, caregiverId, homeFacilityId are required');
  }
  // §19: home births and non-PHC channels are first-class. Default to the
  // facility path when unspecified, but never reject a home birth.
  const setting = birthSetting && BIRTH_SETTINGS.includes(birthSetting) ? birthSetting : 'facility';
  const channel = registrationChannel && REGISTRATION_CHANNELS.includes(registrationChannel) ? registrationChannel : 'phc';

  const [caregiver, facility] = await Promise.all([
    CaregiverModel.findById(caregiverId),
    FacilityModel.findById(homeFacilityId)
  ]);
  if (!caregiver) throw new AppError('caregiverId does not match a known caregiver', 404);
  if (!facility) throw new AppError('homeFacilityId does not match a known facility', 404);

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) throw new AppError('dateOfBirth is not a valid date');

  // Astronomically unlikely to collide (8 base32 chars = 40 bits of entropy)
  // but a health ID system doesn't get to shrug at "unlikely" — retry on the
  // rare unique-index conflict instead of trusting randomness blindly.
  let chin = generateChin();
  for (let attempt = 0; attempt < 5 && (await ChildModel.exists({ chin })); attempt++) {
    chin = generateChin();
  }

  const child = await ChildModel.create({
    chin,
    fullName,
    sex,
    dateOfBirth: dob,
    caregiverId,
    homeFacilityId,
    currentFacilityId: homeFacilityId,
    birthSetting: setting,
    registrationChannel: channel,
    doses: buildDosesForChild(dob)
  });

  res.status(201).json(toChildView(child));
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

  dose.administeredDate = administeredAt ? new Date(administeredAt) : new Date();
  dose.administeredAtFacilityId = facilityId;
  // §17 audit: every genuine administration is written to an append-only ledger.
  await recordAdministration({ chin: child.chin, childId: child._id, vaccineCode, doseNumber: Number(doseNumber), facilityId, ...actor }).catch(() => {});

  const complete = child.doses.every((d) => d.administeredDate);
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
  if (!certificate) throw new AppError('No certificate issued yet — schedule is not complete', 404);
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

  const administered = doses.filter((d) => d.administeredDate).length;
  const next = doses
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
    progress: { administered, total: doses.length, remaining: doses.length - administered },
    nextDue: next
      ? { vaccine: next.displayName, vaccineCode: next.vaccineCode, doseNumber: next.doseNumber, dueDate: next.dueDate }
      : null,
    completedAt: child.completedAt ?? null,
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
