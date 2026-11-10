import { AppError } from './AppError';

// "Continue with Primers ID": swap a one-time code for who the person is. The code is single use,
// expires in 2 minutes and only works with the PKCE verifier created in the person's browser.
// Primers ID shares only a per-app account number, name and verified email.
const ENDPOINT = 'https://atgqjrmcvpctywklfigb.supabase.co/rest/v1/rpc/primers_id_token';
// Publishable (public) key of the Primers ID project; it grants nothing on its own.
const PUBLISHABLE_KEY = 'sb_publishable_Im6hG4bodTfH4PtQvyHp1g_PcOO_6-p';
export const PRIMERS_CLIENT_ID = 'velaji';
export const PRIMERS_REDIRECT_URI = 'https://velaji.primersgroup.ng/auth/primers';

export interface PrimersIdentity { sub: string; email: string; name: string }

export function readPrimersInput(body: unknown): { code: string; verifier: string } {
  const { code, verifier } = (body ?? {}) as { code?: unknown; verifier?: unknown };
  if (typeof code !== 'string' || code.length < 20 || code.length > 200 || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
    throw new AppError('That sign-in expired. Please try again.', 400);
  }
  return { code, verifier };
}

export async function exchangePrimersCode(input: { code: string; verifier: string }): Promise<PrimersIdentity> {
  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: PUBLISHABLE_KEY },
        body: JSON.stringify({ p_client_id: PRIMERS_CLIENT_ID, p_redirect_uri: PRIMERS_REDIRECT_URI, p_code: input.code, p_verifier: input.verifier }),
        signal: AbortSignal.timeout(8000)
      });
      break;
    } catch {
      if (attempt === 1) throw new AppError('Primers ID is unreachable. Try again in a moment.', 503);
    }
  }
  if (!res?.ok) throw new AppError('That sign-in expired. Please try again.', 400);
  const who = (await res.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string } | null;
  if (!who?.sub || !who.email) throw new AppError('That sign-in expired. Please try again.', 400);
  if (!who.email_verified) throw new AppError('Confirm your email on your Primers ID first, then try again.', 400);
  return { sub: String(who.sub), email: String(who.email).toLowerCase(), name: String(who.name ?? '') };
}
