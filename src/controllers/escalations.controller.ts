import type { Request, Response } from 'express';
import { listEscalations, resolveEscalation } from '../services/escalation.service';
import { AppError } from '../utils/AppError';

const VALID_OUTCOMES = ['immunized', 'reached', 'moved_away', 'unreachable', 'other'];

/** The human-tracing work queue. Defaults to open items; ?status=resolved for history. */
export async function getEscalations(req: Request, res: Response) {
  const statusParam = req.query.status;
  const status = statusParam === 'resolved' ? 'resolved' : 'open';
  const escalations = await listEscalations(status);
  res.json({ status, count: escalations.length, escalations });
}

/** Staff mark an escalation resolved after tracing the family. */
export async function postResolveEscalation(req: Request, res: Response) {
  const idParam = req.params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  const { outcome, note } = req.body ?? {};
  if (outcome !== undefined && outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
    throw new AppError(`outcome must be one of: ${VALID_OUTCOMES.join(', ')}`);
  }

  const resolved = await resolveEscalation(id, req.user!.username, outcome ?? 'other', note ?? '');
  res.json(resolved);
}
