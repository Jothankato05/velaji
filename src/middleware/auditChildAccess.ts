import type { NextFunction, Request, Response } from 'express';
import { AccessLogModel } from '../models/AccessLog';
import { normalizeChin } from '../services/chin.service';

/**
 * NCIHAP §24: every access to an individual child's record is written to the
 * append-only audit trail — not only the verification-terminal lookups. This
 * middleware covers the direct staff endpoints (get/journey/card/certificate/
 * doses/handoff/reminders). It records the outcome the client actually got
 * (ok / not_found / denied), derived from the response status once it's sent,
 * so a refused access (403) is logged too.
 *
 * Best-effort by design: a failure to write the audit row must never break the
 * clinical request, so the create is fire-and-forget with a swallowed error.
 * Mount it BEFORE the role guard so denied attempts are still captured.
 */
export function auditChildAccess(req: Request, res: Response, next: NextFunction) {
  const chinParam = req.params.chin;
  const chin = normalizeChin(Array.isArray(chinParam) ? chinParam[0] : String(chinParam ?? ''));
  const user = req.user;

  res.on('finish', () => {
    const outcome = res.statusCode < 300 ? 'ok' : res.statusCode === 404 ? 'not_found' : 'denied';
    void AccessLogModel.create({
      chin,
      childId: null,
      accessedBy: user?.username ?? 'unknown',
      accessorRole: user?.role ?? 'staff',
      method: 'api',
      tier: user?.role ?? 'staff',
      outcome,
      at: new Date()
    }).catch(() => {
      /* audit is best-effort; never fail the request over it */
    });
  });

  next();
}
