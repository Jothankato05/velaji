import { app } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';

async function bootstrap() {
  await connectDatabase();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`NCIHAP prototype API listening on port ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`[config] APP_BASE_URL=${env.APP_BASE_URL}`);
  });

  async function shutdown(signal: string) {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received, shutting down`);
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
