import crypto from 'crypto';
import type { SmsMessage, SmsProvider, SmsSendResult } from './SmsProvider';

/**
 * Development/prototype SMS provider. It does NOT send a real SMS — it logs
 * what would have been sent and returns a synthetic message id, so the whole
 * reminder pipeline (scan -> dedupe -> dispatch -> log) can be exercised end
 * to end without a paid gateway or spamming real phones.
 *
 * Crucially it returns ok:true so downstream logging behaves exactly as it
 * would with a real provider — this is a stub, not a failure simulator.
 */
export class StubSmsProvider implements SmsProvider {
  readonly name = 'stub';

  async send(message: SmsMessage): Promise<SmsSendResult> {
    // eslint-disable-next-line no-console
    console.log(`[sms:stub] -> ${message.to}: ${message.body}`);
    return { ok: true, providerMessageId: `stub_${crypto.randomBytes(6).toString('hex')}` };
  }
}
