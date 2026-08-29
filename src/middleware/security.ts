import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Baseline security response headers, hand-rolled to keep the zero-extra-deps
 * posture (no helmet). Nothing may be framed, sniffed, or treated as an active
 * document beyond what the app genuinely needs.
 *
 * Two policies, because this process serves two different things. API and card
 * responses get `default-src 'none'` — the tightest possible policy, correct
 * for JSON and one SVG. But when the same origin also serves the built SPA
 * (see app.ts), that policy blocks the app's own script and stylesheet and the
 * page renders blank with only a console error to show for it. So document
 * responses get a policy that admits exactly the app's own bundle, its inline
 * styles, Google Fonts, and same-origin XHR — and nothing else.
 */

// For the SPA document: allow only what the app actually loads.
const APP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // Vite injects a small inline style block, and the app sets inline styles for
  // data-driven widths/colours in the dashboard.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  // Without these two the app is not installable and has no offline shell:
  // under default-src 'none' the browser refuses to fetch the manifest and
  // refuses to register the service worker, reporting both only to the
  // console. Nothing else breaks, so it looks like it works.
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// For everything else (JSON, the SVG card): nothing active, at all.
const API_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // A navigation request for a page gets the app policy; API and asset requests
  // keep the strict one. Keyed on the Accept header rather than the path, so it
  // stays correct however the SPA fallback routes evolve.
  const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
  res.setHeader('Content-Security-Policy', wantsHtml ? APP_CSP : API_CSP);
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
