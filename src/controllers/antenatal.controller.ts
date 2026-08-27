import type { Request, Response } from 'express';
import {
  registerPregnancy,
  recordAncVisit,
  linkBirth,
  closePregnancy,
  antenatalPipeline,
  antenatalFollowUp
} from '../services/antenatal.service';

/**
 * Antenatal registration (NCIHAP §19, extended). Opening the child's record at
 * antenatal care — the last reliable contact before the gap in which children
 * become zero-dose. See models/Pregnancy.ts for the evidence.
 */

export async function postPregnancy(req: Request, res: Response) {
  const { caregiverId, facilityId, expectedDeliveryDate } = req.body ?? {};
  const pregnancy = await registerPregnancy({
    caregiverId,
    facilityId,
    expectedDeliveryDate,
    registeredBy: req.user?.username ?? ''
  });
  res.status(201).json(pregnancy);
}

export async function postAncVisit(req: Request, res: Response) {
  const { date, facilityId } = req.body ?? {};
  const pregnancy = await recordAncVisit(String(req.params.ancId), { date, facilityId });
  res.json(pregnancy);
}

export async function postLinkBirth(req: Request, res: Response) {
  const { fullName, sex, dateOfBirth, birthSetting, homeFacilityId } = req.body ?? {};
  const result = await linkBirth(String(req.params.ancId), {
    fullName,
    sex,
    dateOfBirth,
    birthSetting,
    homeFacilityId
  });
  res.status(201).json(result);
}

export async function postClosePregnancy(req: Request, res: Response) {
  const { reason } = req.body ?? {};
  const pregnancy = await closePregnancy(String(req.params.ancId), String(reason ?? 'other'));
  res.json(pregnancy);
}

export async function getAntenatalPipeline(req: Request, res: Response) {
  const weeks = Math.min(52, Math.max(1, Number(req.query.weeks) || 12));
  res.json(await antenatalPipeline(weeks));
}

export async function getAntenatalFollowUp(_req: Request, res: Response) {
  const list = await antenatalFollowUp();
  res.json({ count: list.length, pregnancies: list });
}
