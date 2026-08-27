import type { Request, Response } from 'express';
import { detectIntegrityAlerts } from '../services/fraud.service';

/**
 * Data-integrity alerts for the incentive programme (NCIHAP §17): unusual
 * recording patterns flagged for a human to review. Admin-only aggregate — no
 * individual child data, only worker-level signals.
 */
export async function getIntegrityAlerts(_req: Request, res: Response) {
  const alerts = await detectIntegrityAlerts();
  res.json({ count: alerts.length, alerts });
}
