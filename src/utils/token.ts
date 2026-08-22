import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Minimal self-rolled bearer token: base64url(JSON payload) + "." + HMAC
 * signature over that payload, using node's crypto only (no jsonwebtoken
 * dependency).
 */
/**
 * Roles, least-privilege first (NCIHAP §24). Disclosure at the verification
 * terminal is scoped to the role — a verifier sees only the §16 status
 * headline, a health worker sees the record needed to continue care.
 */
export type StaffRole = 'verifier' | 'staff' | 'admin';

export interface TokenPayload {
  sub: string;
  username: string;
  role: StaffRole;
  iat: number;
  exp: number;
}

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h shift-length session

function sign(payloadB64: string): string {
  return crypto.createHmac('sha256', env.AUTH_TOKEN_SECRET).update(payloadB64).digest('base64url');
}

export function issueToken(user: { id: string; username: string; role: StaffRole }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null; // expired
  }

  return payload;
}
