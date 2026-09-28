/**
 * Phone numbers are stored as typed ("0803 777 1234", "+234 803 777 1234"),
 * while the network reports them in international form ("+2348037771234").
 * Nigerian mobile numbers agree on their last ten digits, so match on those.
 */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

/** A regex source matching a stored number with the same last ten digits,
 *  whatever spaces or dashes were typed between them. Null if the number is
 *  too short to match safely. */
export function phoneMatchSource(phone: string): string | null {
  const key = phoneKey(phone);
  if (key.length < 10) return null;
  return `${key.split('').join('\\D*')}\\D*$`;
}
