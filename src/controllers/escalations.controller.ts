import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { countOpenEscalations, listEscalations, resolveEscalation, defaultingReasons, BARRIERS } from '../services/escalation.service';
import { AppError } from '../utils/AppError';
import { currentUser } from '../middleware/requireAuth';

const VALID_OUTCOMES = ['immunized', 'reached', 'moved_away', 'unreachable', 'other'];

/** The human-tracing work queue. Defaults to open items; ?status=resolved for history. */
export async function getEscalations(req: Request, res: Response) {
  const statusParam = req.query.status;
  const status = statusParam === 'resolved' ? 'resolved' : 'open';
  const escalations = await listEscalations(status);
  res.json({ status, count: escalations.length, escalations });
}

/** Just the number of open cases, for the navigation badge. */
export async function getEscalationCount(_req: Request, res: Response) {
  res.json({ open: await countOpenEscalations() });
}

/** Staff mark an escalation resolved after tracing the family. */
export async function postResolveEscalation(req: Request, res: Response) {
  const idParam = req.params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  if (!mongoose.isValidObjectId(id)) throw new AppError('Invalid escalation id', 400);

  const { outcome, note, barrier, comeBy } = req.body ?? {};
  let comeByDate: Date | null = null;
  if (comeBy) {
    comeByDate = new Date(comeBy);
    const days = (comeByDate.getTime() - Date.now()) / 86_400_000;
    if (Number.isNaN(comeByDate.getTime()) || days < -1 || days > 90) {
      throw new AppError('comeBy must be a date within the next 90 days');
    }
  }
  if (outcome !== undefined && outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
    throw new AppError(`outcome must be one of: ${VALID_OUTCOMES.join(', ')}`);
  }
  if (barrier !== undefined && barrier !== null && !BARRIERS.includes(barrier)) {
    throw new AppError(`barrier must be one of: ${BARRIERS.join(', ')}`);
  }

  const resolved = await resolveEscalation(id, currentUser(req).username, outcome ?? 'other', note ?? '', barrier ?? null, comeByDate);
  res.json(resolved);
}

/** Why children default, in aggregate (§11 intelligence). Admin-only. */
export async function getDefaultingReasons(_req: Request, res: Response) {
  res.json(await defaultingReasons());
}
