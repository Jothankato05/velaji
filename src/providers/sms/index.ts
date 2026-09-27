import { env } from '../../config/env';
import type { SmsProvider } from './SmsProvider';
import { StubSmsProvider } from './stubSmsProvider';

let cached: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  switch (env.SMS_PROVIDER) {
    default:
      cached = new StubSmsProvider();
      break;
  }

  return cached;
}

export type { SmsProvider, SmsMessage, SmsSendResult } from './SmsProvider';
