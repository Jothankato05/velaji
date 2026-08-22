import type { Request, Response } from 'express';
import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { normalizeChin } from '../services/chin.service';
import { computeChildStatus } from '../services/schedule.service';
import { verifyChinToken } from '../services/verification-token.service';
import { AppError } from '../utils/AppError';

/**
 * Public endpoint reached by scanning a card's QR code. Deliberately returns
 * less than the full staff view (getChild) — enough for a facility worker to
 * confirm who they're looking at and what's due, nothing a lost card should
 * leak beyond that.
 */
export async function verifyChin(req: Request, res: Response) {
  const chinParam = req.params.chin;
  const chin = normalizeChin(Array.isArray(chinParam) ? chinParam[0] : chinParam);
  const token = String(req.query.t ?? '');

  if (!token || !verifyChinToken(chin, token)) {
    throw new AppError('Invalid or missing verification token', 401);
  }

  const child = await ChildModel.findOne({ chin });
  if (!child) throw new AppError('CHIN not found', 404);

  const facility = await FacilityModel.findById(child.currentFacilityId);
  // Explicit field access, not `{...d}` — spreading a Mongoose subdocument
  // does not reliably carry its schema fields onto the plain object.
  const doses = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode,
    displayName: d.displayName,
    doseNumber: d.doseNumber,
    dueDate: d.dueDate,
    administeredDate: d.administeredDate ?? null
  }));
  const status = computeChildStatus(doses, { needsReconciliation: child.needsReconciliation });

  const nextDue = doses
    .filter((d) => !d.administeredDate)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  res.json({
    chin: child.chin,
    fullName: child.fullName,
    status,
    currentFacility: facility?.name ?? null,
    nextDue: nextDue ? { vaccine: nextDue.displayName, dueDate: nextDue.dueDate } : null,
    completedAt: child.completedAt
  });
}
