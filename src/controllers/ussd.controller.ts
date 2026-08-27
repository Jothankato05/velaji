import type { Request, Response } from 'express';
import { handleUssd } from '../services/ussd.service';

/**
 * USSD gateway webhook (NCIHAP §8). Telecom USSD gateways (Africa's Talking and
 * most others) POST the session's accumulated input and reply in plain text
 * prefixed with CON (keep the session open, expect more input) or END (final
 * screen, close the session). Public — the caller is the telecom gateway, which
 * cannot present a bearer token; the phone number is provided by the network.
 */
export async function handleUssdWebhook(req: Request, res: Response) {
  const phoneNumber = String(req.body?.phoneNumber ?? '');
  const text = String(req.body?.text ?? '');

  const result = await handleUssd({ phoneNumber, text });
  res.type('text/plain').send(`${result.continue ? 'CON' : 'END'} ${result.message}`);
}
