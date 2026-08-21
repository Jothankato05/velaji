import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Short HMAC token bound to a CHIN, embedded in the QR code on a child's
 * card. Lets a facility scan the card and hit a public verification
 * endpoint without full staff auth, while still proving the QR wasn't
 * forged or edited (same "sign the thing you'll be asked to prove" pattern
 * as Twilio's own webhook signatures).
 */
export function signChin(chin: string): string {
  return crypto.createHmac('sha256', env.CARD_SIGNING_SECRET).update(chin).digest('base64url').slice(0, 12);
}

export function verifyChinToken(chin: string, token: string): boolean {
  const expected = signChin(chin);
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
