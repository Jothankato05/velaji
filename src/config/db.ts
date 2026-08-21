import mongoose from 'mongoose';
import { env } from './env';

let memoryServerHandle: { stop: () => Promise<boolean> } | null = null;

export async function connectDatabase(): Promise<void> {
  if (env.MONGODB_URI) {
    await mongoose.connect(env.MONGODB_URI);
    // eslint-disable-next-line no-console
    console.log('[db] Connected to MongoDB (configured URI).');
    return;
  }

  if (!env.ALLOW_IN_MEMORY_DB) {
    throw new Error(
      '[db] No MONGODB_URI set. Either provide one, or set ALLOW_IN_MEMORY_DB=true for local dev ' +
        '(data will not persist across restarts).'
    );
  }

  // Local/dev-only fallback: spin up an ephemeral in-memory MongoDB so the
  // prototype runs with zero external setup. Never used in production —
  // env.ts refuses to boot with ALLOW_IN_MEMORY_DB=true when NODE_ENV=production.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  memoryServerHandle = mem;
  await mongoose.connect(mem.getUri());
  // eslint-disable-next-line no-console
  console.log('[db] Connected to an EPHEMERAL in-memory MongoDB (ALLOW_IN_MEMORY_DB=true). Data will not persist.');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServerHandle) {
    await memoryServerHandle.stop();
    memoryServerHandle = null;
  }
}
