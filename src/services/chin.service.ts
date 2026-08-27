import crypto from 'crypto';

/**
 * Child Health Identification Number (CHIN).
 *
 * Format exactly as written in the NCIHAP concept note (§4):
 *
 *     CHIN: NG-25-09-18472639
 *
 * i.e. NG-<2-digit year>-<2-digit month of registration>-<8-digit serial>.
 * The final digit of the serial is a Luhn (mod 10) check digit, so a
 * hand-copied or misheard number is caught before it points at the wrong
 * child. Numbers are read aloud and copied by hand at rural facilities, so a
 * self-checking number matters.
 *
 * CRITICAL PRINCIPLE (§4): the CHIN identifies the health RECORD; it is NOT
 * Nigeria's National Identification Number (NIN), which identifies the person.
 */

/** Luhn (mod 10) check digit for a numeric payload string. */
function luhnCheckDigit(payload: string): string {
  let sum = 0;
  let double = true; // the rightmost payload digit is doubled (check digit sits to its right)
  for (let i = payload.length - 1; i >= 0; i--) {
    let d = payload.charCodeAt(i) - 48;
    if (d < 0 || d > 9) throw new Error(`Invalid digit in CHIN payload: ${payload[i]}`);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

function twoDigit(n: number): string {
  return String(n).padStart(2, '0');
}

export function generateChin(now: Date = new Date()): string {
  const yy = twoDigit(now.getFullYear() % 100);
  const mm = twoDigit(now.getMonth() + 1);
  // 7 random digits + 1 Luhn check digit = 8-digit serial.
  let serial7 = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) serial7 += String(bytes[i] % 10);
  const check = luhnCheckDigit(serial7);
  return `NG-${yy}-${mm}-${serial7}${check}`;
}

/**
 * Antenatal Registration Identifier (ANC ID) — the record opened when a woman
 * is registered at antenatal care, before the child exists.
 *
 *     ANC: NG-ANC-18472639
 *
 * Deliberately a SEPARATE namespace from the CHIN, for two reasons:
 *
 *  1. A pregnancy is not a child. §4's critical principle is that the CHIN
 *     identifies a child's health record; issuing one before birth would make
 *     the registry assert a child exists when it does not, and would have to be
 *     unwound in the case of a loss. The ANC ID converts to a CHIN at birth.
 *  2. The CHIN encodes the year and month of registration. An expected delivery
 *     date moves; an identifier must not.
 *
 * Same Luhn check digit as the CHIN, for the same reason — these numbers are
 * read aloud and copied by hand.
 *
 * Modelled on the mother/child identifier split used by India's RCH portal,
 * where a pregnancy is registered against its own ID and the newborn's record
 * is linked to it at delivery.
 */
export function generateAncId(): string {
  let serial7 = '';
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) serial7 += String(bytes[i] % 10);
  return `NG-ANC-${serial7}${luhnCheckDigit(serial7)}`;
}

const ANC_RE = /^NG-ANC-(\d{7})(\d)$/;

export function isValidAncIdFormat(ancId: string): boolean {
  const match = ANC_RE.exec(normalizeChin(ancId));
  if (!match) return false;
  const [, payload, check] = match;
  return luhnCheckDigit(payload) === check;
}

const CHIN_RE = /^NG-\d{2}-\d{2}-(\d{7})(\d)$/;

export function isValidChinFormat(chin: string): boolean {
  const match = CHIN_RE.exec(normalizeChin(chin));
  if (!match) return false;
  const [, payload, check] = match;
  return luhnCheckDigit(payload) === check;
}

export function normalizeChin(chin: string): string {
  return chin.trim().toUpperCase().replace(/\s+/g, '');
}
