import { ChildModel } from './models/Child';

/**
 * Public demo instances start empty, which makes the Command Centre look
 * broken rather than new. When DEMO_SEED_ON_BOOT is set we populate the
 * invented demo dataset — but ONLY if the database has no children, so a
 * redeploy never duplicates it and it can never overwrite real records.
 */
export async function seedDemoIfEnabled(): Promise<void> {
  if (process.env.DEMO_SEED_ON_BOOT !== 'true') return;
  const existing = await ChildModel.estimatedDocumentCount();
  if (existing === 0) {
    const { seedDemoData } = await import('./scripts/demoSeed');
    const { cardChin, ussdPhone } = await seedDemoData();
    // eslint-disable-next-line no-console
    console.log(`[demo] seeded: card CHIN ${cardChin}, USSD ${ussdPhone}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[demo] skipped: database already holds ${existing} children`);
  }
}
