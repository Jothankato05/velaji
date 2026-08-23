import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Body-parser errors (oversized or malformed JSON) arrive as plain errors
  // carrying a 4xx status. Answer them cleanly rather than as a 500 — a bad
  // request is the client's fault, not a server fault, and shouldn't be logged
  // as one or leak internals.
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const msg = status === 413 ? 'Request body too large' : 'Malformed request body';
    res.status(status).json({ error: msg });
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
