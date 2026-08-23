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

app.use(notFoundHandler);
app.use(errorHandler);
