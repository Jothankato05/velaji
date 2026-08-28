import { app } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { startReminderJob, stopReminderJob } from './jobs/reminder.job';
import { ChildModel } from './models/Child';

async function bootstrap() {
  await connectDatabase();

  // Public demo instances start empty, which makes the Command Centre look
  // broken rather than new. When DEMO_SEED_ON_BOOT is set we populate the
  // invented demo dataset — but ONLY if the database has no children, so a
  // redeploy never duplicates it and it can never overwrite real records.
  if (process.env.DEMO_SEED_ON_BOOT === 'true') {
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

  startReminderJob();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Velaji API listening on port ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`[config] APP_BASE_URL=${env.APP_BASE_URL}`);
  });

  async function shutdown(signal: string) {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received, shutting down`);
    stopReminderJob();
    server.close();
    await disconnectDatabase();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  void bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
