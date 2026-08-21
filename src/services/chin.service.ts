import crypto from 'crypto';

/**
 * Child Health Identification Number (CHIN).
 *
 * This is a system-generated identifier for THIS software only. It is
 * explicitly NOT Nigeria's National Identification Number (NIN) and carries
 * no NIMC/NPC authority — see README "Scope" section. It exists so a child
 * with no birth certificate or NIN can still be tracked reliably across
 * visits and facilities.
 *
 * Format: CHN-XXXX-XXXX-Y  (X = payload, Y = check character)
 * Alphabet: Crockford base32 (excludes I, L, O, U — hard to confuse by eye
 * or over a bad phone line, which matters for a system meant to be read
 * aloud or copied by hand at a rural facility).
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars, Crockford-style
const PAYLOAD_LENGTH = 8;

function randomPayload(): string {
  const bytes = crypto.randomBytes(PAYLOAD_LENGTH);
  let out = '';
  for (let i = 0; i < PAYLOAD_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Standard "Luhn mod N" check character algorithm, generalized from the
 * classic Luhn algorithm to an arbitrary alphabet. Catches the errors that
 * actually happen with hand-copied IDs: single mistyped characters and
 * adjacent-character transpositions.
 */
function luhnModNCheckChar(input: string): string {
  const n = ALPHABET.length;
  let factor = 2;
  let sum = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(input[i]);
    if (codePoint === -1) throw new Error(`Invalid character in CHIN payload: ${input[i]}`);
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / n) + (addend % n);
    sum += addend;
  }
  const remainder = sum % n;
  const checkCodePoint = (n - remainder) % n;
  return ALPHABET[checkCodePoint];
}

export function generateChin(): string {
  const payload = randomPayload();
  const check = luhnModNCheckChar(payload);
  const grouped = `${payload.slice(0, 4)}-${payload.slice(4, 8)}`;
  return `CHN-${grouped}-${check}`;
}

export function isValidChinFormat(chin: string): boolean {
  const match = /^CHN-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z])$/.exec(
    chin.trim().toUpperCase()
  );
  if (!match) return false;
  const payload = match[1] + match[2];
  const check = match[3];
  return luhnModNCheckChar(payload) === check;
}

export function normalizeChin(chin: string): string {
  return chin.trim().toUpperCase();
}
