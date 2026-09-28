import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Request, Response } from 'express';
import { app } from './app';
import { connectDatabase } from './config/db';
import { seedDemoIfEnabled } from './demo';

// Entry point for serverless hosts (Vercel), where there is no long-running
// server.ts: each warm instance connects once and reuses the connection. A
// failed start is forgotten so the next request retries instead of every
// request failing for the life of the instance.
let ready: Promise<void> | null = null;

function start(): Promise<void> {
  ready ??= connectDatabase()
    .then(seedDemoIfEnabled)
    .catch((error: unknown) => {
      ready = null;
      throw error;
    });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await start();
  app(req as Request, res as Response);
}
