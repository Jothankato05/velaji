import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/**
 * A small fixed-window, in-memory rate limiter — enough to blunt credential
 * stuffing / brute force on the login endpoint without a new dependency.
 *
 * Caveat by design: state lives in this process only. A multi-instance
 * production deployment must move this to a shared store (Redis) so the limit
 * is enforced across instances. Documented here so it isn't mistaken for
 * cluster-wide protection.
 */
interface Bucket { count: number; resetAt: number; }

export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const { windowMs, max } = opts;
  const keyOf = opts.key ?? ((req: Request) => req.ip ?? 'unknown');
  const buckets = new Map<string, Bucket>();

  // Opportunistic sweep so the map can't grow without bound under a spray of
  // distinct keys (e.g. spoofed X-Forwarded-For).
  function sweep(now: number) {
    if (buckets.size < 5000) return;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now);
    const key = keyOf(req);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      throw new AppError('Too many attempts. Please wait and try again.', 429);
    }
    next();
  };
}
