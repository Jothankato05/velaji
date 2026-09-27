import crypto from 'node:crypto';

const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(plain, salt, SCRYPT_KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;

  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(plain, salt, SCRYPT_KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
  });

  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
