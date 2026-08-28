import path from 'path';
import fs from 'fs';
import express from 'express';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { securityHeaders, forceHttps } from './middleware/security';

export const app = express();

// We run behind a TLS-terminating proxy in production; trust its forwarded
// headers so req.ip and x-forwarded-proto are the real client's, not the proxy.
app.set('trust proxy', 1);

app.use(forceHttps);
app.use(securityHeaders);
// Cap request bodies: our largest legitimate payload is a small JSON object.
// A hard limit turns an oversized/hostile body into a cheap 413 instead of
// letting it consume memory.
app.use(express.json({ limit: '64kb' }));
// Serve the built SPA from the same origin as the API when it is present in the
// image (production). One URL means no CORS to configure and one link to hand
// out. In dev the Vite server owns the SPA and this directory does not exist,
// so the whole block is skipped.
//
// ORDER MATTERS, and getting it wrong is silent: apiRouter ends with an
// unscoped `.use(requireAuth)`, which intercepts EVERY path that reaches it —
// so anything registered after apiRouter gets a 401 instead of a page. Both
// handlers below therefore sit BEFORE it, and the fallback excludes the API
// prefixes itself so a genuine unknown /api path still falls through to
// apiRouter and 404s as JSON rather than returning index.html.
const webDist = path.resolve(__dirname, '../web-dist');
if (fs.existsSync(webDist)) {
  // Real built files first: /assets/*.js, /assets/*.css, favicon, and so on.
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  // The pitch deck is a standalone static page, not part of the SPA, so it gets
  // an explicit route ahead of the fallback — otherwise /deck would be handed to
  // React, which has no such route. /deck.html works via express.static above;
  // this just gives it the tidier URL.
  app.get('/deck', (_req, res) => res.sendFile(path.join(webDist, 'deck.html')));

  // Then the SPA fallback, so client-side routes (/, /dashboard,
  // /mychild/:chin) survive a hard refresh or a link opened cold.
  app.get(/^\/(?!api\/|webhooks\/|health$|ready$).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use(apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
