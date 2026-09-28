import mongoose from 'mongoose';
import { CaregiverModel } from './models/Caregiver';
import { ChildModel } from './models/Child';
import { StaffUserModel } from './models/StaffUser';

/**
 * Bump when the demo dataset changes shape, so public demo instances replace
 * their old demo data on the next boot instead of keeping it forever.
 *   2: children spread across realistic ages, doses given 0-9 days late.
 */
export const DEMO_SEED_VERSION = 2;

/** Demo dates are relative to when it was seeded, so the recent weeks empty out
 *  as time passes (nobody records real doses on the demo). Reseed once the data
 *  is this old, so charts like "doses administered" always show recent weeks. */
export const DEMO_REFRESH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const meta = db.collection<{ _id: string; version: number | null; seededAt?: Date }>(META);
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

  // Claim the (re)seed atomically so concurrent cold starts don't both run it:
  // whoever loses gets a duplicate-key error from the upsert and backs off.
  try {
    await meta.updateOne(
      { _id: META_ID, $or: [{ version: { $ne: DEMO_SEED_VERSION } }, { seededAt: { $exists: false } }, { seededAt: { $lt: staleBefore } }] },
      { $set: { version: DEMO_SEED_VERSION, seededAt: now } },
      { upsert: true }
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return;
    throw err;
  }

  try {
    if (existing > 0) {
      for (const c of await db.collections()) {
        if (c.collectionName !== META) await c.deleteMany({});
      }
    }
    const { seedDemoData } = await import('./scripts/demoSeed');
    const { cardChin, ussdPhone } = await seedDemoData();
    // eslint-disable-next-line no-console
    console.log(`[demo] seeded version ${DEMO_SEED_VERSION}: card CHIN ${cardChin}, USSD ${ussdPhone}`);
  } catch (err) {
    // Release the claim so the next boot retries rather than keeping half a dataset.
    await meta.updateOne({ _id: META_ID }, { $set: { version: null } });
    throw err;
  }
}
