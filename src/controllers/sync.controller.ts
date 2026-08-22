import type { Request, Response } from 'express';
import { pullChanges, pushTransactions } from '../services/sync.service';
import { AppError } from '../utils/AppError';

/**
 * Offline-first sync (NCIHAP §9). A health-worker device pulls the children it
 * needs so it can search and record while offline, then pushes what it did
 * when connectivity returns.
 */
export async function getPull(req: Request, res: Response) {
  const facilityId = typeof req.query.facilityId === 'string' ? req.query.facilityId : '';
  if (!facilityId) throw new AppError('facilityId query param is required');
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  res.json(await pullChanges(facilityId, since));
}

export async function postPush(req: Request, res: Response) {
  const { deviceId, transactions } = req.body ?? {};
  const summary = await pushTransactions(String(deviceId ?? ''), transactions, { username: req.user!.username });
  res.json(summary);
}
