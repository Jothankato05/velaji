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

export async function registerChild(req: Request, res: Response) {
  const { fullName, sex, dateOfBirth, caregiverId, homeFacilityId } = req.body ?? {};
  if (!fullName || !sex || !dateOfBirth || !caregiverId || !homeFacilityId) {
    throw new AppError('fullName, sex, dateOfBirth, caregiverId, homeFacilityId are required');
  }

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

  dose.administeredDate = administeredAt ? new Date(administeredAt) : new Date();
  dose.administeredAtFacilityId = facilityId;

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

export async function recordHandoff(req: Request, res: Response) {
  const child = await findChildOr404(req.params.chin);
  const { toFacilityId, lat, lng, reason } = req.body ?? {};
  if (!toFacilityId || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new AppError('toFacilityId, lat, lng are required');
  }

  const toFacility = await FacilityModel.findById(toFacilityId);
  if (!toFacility) throw new AppError('toFacilityId does not match a known facility', 404);

  const handoff = await FacilityHandoffModel.create({
    childId: child._id,
    fromFacilityId: child.currentFacilityId,
    toFacilityId,
    reportedLocation: { lat, lng },
    reason: reason ?? '',
    handoffAt: new Date()
  });

  child.currentFacilityId = toFacilityId;
  await child.save();

  res.status(201).json(handoff);
}
