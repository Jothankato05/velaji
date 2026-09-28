import mongoose from 'mongoose';
import { CaregiverModel } from './models/Caregiver';
import { ChildModel } from './models/Child';
import { StaffUserModel } from './models/StaffUser';

/**
 * Bump when the demo dataset changes shape, so public demo instances replace
 * their old demo data on the next boot instead of keeping it forever.
 *   2: children spread across realistic ages, doses given 0-9 days late.
 *   3: same data; forces a rebuild of demos a timed-out reseed left partial.
 *   4: open follow-ups for the longest-overdue children.
 *   5: children numbered per clinic, so no two share a name.
 */
export const DEMO_SEED_VERSION = 5;

/** Demo dates are relative to when it was seeded, so the recent weeks empty out
 *  as time passes (nobody records real doses on the demo). Reseed once the data
 *  is this old, so charts like "doses administered" always show recent weeks. */
export const DEMO_REFRESH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A (re)seed holds a lock this long. If the process dies mid-seed (a
 *  serverless timeout), the lock lapses and the next boot tries again. */
const LOCK_MS = 5 * 60 * 1000;

const META = 'demo_meta';
const META_ID = 'seed';

/** The demo seed's own fingerprint: its admin login plus the MyChild/USSD
 *  caregiver's reserved number. A database without both was not made by it. */
async function holdsDemoSeed(): Promise<boolean> {
  const [admin, caregiver] = await Promise.all([
    StaffUserModel.exists({ username: 'admin' }),
    CaregiverModel.exists({ phone: '+2348010000001' })
  ]);
  return Boolean(admin && caregiver);
}

/**
 * Public demo instances start empty, which makes the overview look broken
 * rather than new. When DEMO_SEED_ON_BOOT is set we populate the invented demo
 * dataset if the database is empty, or replace it if it holds an older version
 * of the demo seed or one more than DEMO_REFRESH_DAYS old. A database holding
 * anything else is never touched.
 */
export async function seedDemoIfEnabled(): Promise<void> {
  if (process.env.DEMO_SEED_ON_BOOT !== 'true') return;
  const db = mongoose.connection.db;
  if (!db) return;
  const meta = db.collection<{ _id: string; version: number | null; seededAt?: Date; lockedUntil?: Date | null }>(META);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - DEMO_REFRESH_DAYS * DAY_MS);

  const existing = await ChildModel.estimatedDocumentCount();
  if (existing > 0) {
    const current = await meta.findOne({ _id: META_ID });
    if (current?.version === DEMO_SEED_VERSION && current.seededAt && current.seededAt >= staleBefore) {
      // eslint-disable-next-line no-console
      console.log(`[demo] skipped: demo data is version ${DEMO_SEED_VERSION}, seeded ${current.seededAt.toISOString()}`);
      return;
    }
    if (!current && !(await holdsDemoSeed())) {
      // eslint-disable-next-line no-console
      console.log(`[demo] skipped: database holds ${existing} children that are not demo data`);
      return;
    }
  }

  // Claim the (re)seed atomically so concurrent cold starts don't both run it.
  // The claim only takes a lock; the seed counts as done (version + seededAt)
  // once it has finished, so a reseed cut off part-way is retried rather than
  // left half-built. Whoever loses the claim gets a duplicate-key error from
  // the upsert and backs off.
  try {
    await meta.updateOne(
      {
        _id: META_ID,
        $and: [
          { $or: [{ version: { $ne: DEMO_SEED_VERSION } }, { seededAt: { $exists: false } }, { seededAt: { $lt: staleBefore } }] },
          { $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: null }, { lockedUntil: { $lt: now } }] }
        ]
      },
      { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } },
      { upsert: true }
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return;
    throw err;
  }

  try {
    if (existing > 0) {
      await Promise.all((await db.collections()).filter((c) => c.collectionName !== META).map((c) => c.deleteMany({})));
    }
    const { seedDemoData } = await import('./scripts/demoSeed');
    const { cardChin, ussdPhone } = await seedDemoData();
    await meta.updateOne({ _id: META_ID }, { $set: { version: DEMO_SEED_VERSION, seededAt: new Date(), lockedUntil: null } });
    // eslint-disable-next-line no-console
    console.log(`[demo] seeded version ${DEMO_SEED_VERSION} in ${Date.now() - now.getTime()} ms: card CHIN ${cardChin}, USSD ${ussdPhone}`);
  } catch (err) {
    // Release the lock so the next boot retries straight away.
    await meta.updateOne({ _id: META_ID }, { $set: { lockedUntil: null } });
    throw err;
  }
}
