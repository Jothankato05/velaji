/**
 * Dev-only: boot the real API on PORT with the demo dataset so the MyChild and
 * Command Centre UIs can be driven in a browser against real data. Prints the
 * admin credentials, the MyChild card link and the USSD phone. Not production.
 */
import { app } from '../app';
import { env } from '../config/env';
import { connectDatabase } from '../config/db';
import { seedDemoData } from './demoSeed';

async function main() {
  await connectDatabase();
  const { cardChin, cardToken, ussdPhone } = await seedDemoData();

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SEEDED API on ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log('ADMIN_LOGIN=admin / admin-demo-pass');
    // eslint-disable-next-line no-console
    console.log(`CARD_LINK=${env.APP_BASE_URL}/mychild/${cardChin}?t=${cardToken}`);
    // eslint-disable-next-line no-console
    console.log(`USSD_PHONE=${ussdPhone}`);
  });
}

void main().catch((e) => { console.error(e); process.exit(1); });
