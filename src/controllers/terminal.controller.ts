import type { Request, Response } from 'express';
import { terminalLookup, getAccessLog } from '../services/terminal.service';
import { normalizeChin } from '../services/chin.service';
import { AppError } from '../utils/AppError';

/**
 * The authorised verification terminal (NCIHAP §16). Any authenticated staff
 * member looks a child up by typed CHIN or scanned QR; the response is scoped
 * to their role, and the access is written to the audit trail.
 */
export async function postTerminalLookup(req: Request, res: Response) {
  const { chin, qr } = req.body ?? {};
  if (!chin && !qr) {
    throw new AppError('Provide either a CHIN (typed) or a QR (scanned)');
  }

  const result = await terminalLookup(
    { chin, qr },
    { username: req.user!.username, role: req.user!.role }
  );
  res.json(result);
}

/** Admin: review who has accessed a child's record (audit trail, §24). */
export async function getChildAccessLog(req: Request, res: Response) {
  const chinParam = req.params.chin;
  const chin = normalizeChin(Array.isArray(chinParam) ? chinParam[0] : chinParam);
  const log = await getAccessLog(chin);
  res.json({ chin, count: log.length, accesses: log });
}
