import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Baseline security response headers, hand-rolled to keep the zero-extra-deps
 * posture (no helmet). This API serves JSON plus one SVG card, so the policy
 * is deliberately tight: nothing may be framed, sniffed, or treated as an
 * active document.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Only the SVG card embeds anything (a data: QR image); everything else is
  // JSON. default-src 'none' is safe for an API and blocks any accidental
  // active content; img-src data: keeps the card's embedded QR working.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.removeHeader('X-Powered-By');

  // HSTS only makes sense once TLS terminates in front of us (production).
  if (env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
}

/**
 * Force HTTPS in production. We sit behind a TLS-terminating proxy (so
 * app.set('trust proxy', …) is on), which forwards the original scheme in
 * x-forwarded-proto. A plain-HTTP request is 308-redirected to its HTTPS
 * equivalent so a health worker's link can never silently downgrade.
 */
export function forceHttps(req: Request, res: Response, next: NextFunction) {
  if (env.NODE_ENV !== 'production') return next();
  const proto = req.header('x-forwarded-proto');
  if (proto && proto !== 'https') {
    return res.redirect(308, `https://${req.header('host')}${req.originalUrl}`);
  }
  next();
}
