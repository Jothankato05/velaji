export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsSendResult {
  ok: boolean;
  providerMessageId: string | null;
  error?: string;
}

/**
 * The seam a real SMS provider (Twilio, Africa's Talking, Termii...) plugs
 * into. Kept deliberately narrow so swapping providers never touches the
 * reminder logic. Same pattern ImmuniReach uses for telephony/SMS.
 */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}
