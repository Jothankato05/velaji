import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type TokenPayload, type StaffRole } from '../utils/token';
import { AppError } from '../utils/AppError';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Missing or malformed Authorization header', 401);
  }

  const payload = verifyToken(token);
  if (!payload) {
    throw new AppError('Invalid or expired token', 401);
  }

  req.user = payload;
  next();
}

/** The signed-in staff user. Only call behind `requireAuth`; it answers 401
 *  rather than asserting, so a route wired without the guard fails safely. */
export function currentUser(req: Request): TokenPayload {
  if (!req.user) throw new AppError('Not authenticated', 401);
  return req.user;
}

export function requireRole(...roles: StaffRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError('Not authenticated', 401);
    if (!roles.includes(req.user.role)) throw new AppError('Forbidden', 403);
    next();
  };
}
