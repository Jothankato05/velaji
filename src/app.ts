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
app.use(apiRouter);

// Serve the built SPA from the same origin as the API when it is present in the
// image (production). One URL means no CORS to configure and one link to hand
// out. In dev the Vite server owns the SPA and this directory does not exist,
// so the block is skipped entirely.
const webDist = path.resolve(__dirname, '../web-dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  // SPA fallback: any non-API GET that is not a real file returns index.html so
  // client-side routes (/dashboard, /mychild/:chin) survive a hard refresh.
  // Registered AFTER apiRouter, so a genuine unknown /api path still 404s JSON.
  app.get(/^\/(?!api\/|webhooks\/|health$|ready$).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
