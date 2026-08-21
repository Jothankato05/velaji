import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  MONGODB_URI: z.string().optional(),
  ALLOW_IN_MEMORY_DB: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  APP_BASE_URL: z
    .string()
    .default('http://localhost:4100')
    // Lesson learned the hard way on ImmuniReach: a trailing slash here silently
    // breaks every link/signature built by concatenation. Normalize once, here.
    .transform((value) => value.replace(/\/+$/, '')),
  CARD_SIGNING_SECRET: z.string().default('dev-only-insecure-secret-change-me'),
  // Deliberately separate from CARD_SIGNING_SECRET: the QR-verification token
  // is meant to be handed to anyone scanning a card, staff bearer tokens are
  // not — one leaking should never weaken the other.
  AUTH_TOKEN_SECRET: z.string().default('dev-only-insecure-auth-secret-change-me')
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (!parsed.MONGODB_URI) problems.push('MONGODB_URI is required in production');
  if (parsed.ALLOW_IN_MEMORY_DB) problems.push('ALLOW_IN_MEMORY_DB must not be true in production');
  if (parsed.CARD_SIGNING_SECRET === 'dev-only-insecure-secret-change-me') {
    problems.push('CARD_SIGNING_SECRET must be overridden in production');
  }
  if (parsed.AUTH_TOKEN_SECRET === 'dev-only-insecure-auth-secret-change-me') {
    problems.push('AUTH_TOKEN_SECRET must be overridden in production');
  }
  if (parsed.APP_BASE_URL.includes('localhost')) {
    problems.push('APP_BASE_URL must be a real public URL in production');
  }
  if (problems.length > 0) {
    throw new Error(`[env] Refusing to start in production:\n - ${problems.join('\n - ')}`);
  }
}

export const env = parsed;
