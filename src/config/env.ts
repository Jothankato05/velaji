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
    // A trailing slash here silently breaks every link/signature built by
    // string concatenation (e.g. QR verification URLs). Normalize once, here.
    .transform((value) => value.replace(/\/+$/, '')),
  CARD_SIGNING_SECRET: z.string().default('dev-only-insecure-secret-change-me'),
  // Deliberately separate from CARD_SIGNING_SECRET: the QR-verification token
  // is meant to be handed to anyone scanning a card, staff bearer tokens are
  // not — one leaking should never weaken the other.
  AUTH_TOKEN_SECRET: z.string().default('dev-only-insecure-auth-secret-change-me'),

  // --- Reminder engine ---
  // Off by default because a real deployment dials/texts real caregivers; it
  // must be turned on deliberately. Even when on, the SMS provider is a
  // console stub until SMS_PROVIDER is configured (see providers/sms).
  REMINDER_ENGINE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // How often the scan-and-dispatch cycle runs.
  REMINDER_SCAN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  // Don't re-remind the same child for the same dose more often than this.
  REMINDER_COOLDOWN_HOURS: z.coerce.number().int().positive().default(48),
  // Give up after this many reminders for one dose (avoid harassing a caregiver
  // who isn't responding — that dose needs human outreach, not more SMS).
  REMINDER_MAX_PER_DOSE: z.coerce.number().int().positive().default(3),
  // Only send within this local-hour window [start, end). Default 08:00–20:00
  // so a caregiver is never texted in the middle of the night.
  REMINDER_SEND_START_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  REMINDER_SEND_END_HOUR: z.coerce.number().int().min(0).max(24).default(20),
  // 'stub' logs to console; real providers are wired in later behind this seam.
  SMS_PROVIDER: z.enum(['stub']).default('stub')
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
