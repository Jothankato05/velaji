import type { Request, Response } from 'express';
import { overdueChildren, type GeoFilter } from '../services/dashboard.service';

function readFilter(req: Request): GeoFilter {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return { state: str(req.query.state), lga: str(req.query.lga), ward: str(req.query.ward) };
}

/**
 * The recovery call list for a scope (NCIHAP §11 "real-time intervention"):
 * the overdue children a worker needs to act on, reached from the Command
 * Centre drill-down. Individual data → staff/admin only.
 */
export async function getRecovery(req: Request, res: Response) {
  const children = await overdueChildren(readFilter(req));
  res.json({ count: children.length, children });
}
