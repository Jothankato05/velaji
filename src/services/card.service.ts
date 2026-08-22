import QRCode from 'qrcode';
import { env } from '../config/env';
import { signChin } from './verification-token.service';

export function buildVerificationUrl(chin: string): string {
  const token = signChin(chin);
  return `${env.APP_BASE_URL}/api/verify/${encodeURIComponent(chin)}?t=${token}`;
}

export async function generateQrPngDataUrl(chin: string): Promise<string> {
  const url = buildVerificationUrl(chin);
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

/**
 * A minimal, printable card as self-contained SVG (embeds the QR as a raster
 * data URI inside an <image> tag) — no client-side rendering dependency,
 * works from curl, and prints fine at a facility with a basic printer.
 */
export async function generatePrintableCardSvg(input: {
  chin: string;
  fullName: string;
  sex: string;
  dateOfBirth: Date;
  facilityName: string;
  caregiverName?: string;
  caregiverPhone?: string;
}): Promise<string> {
  const qrDataUrl = await generateQrPngDataUrl(input.chin);
  const dob = input.dateOfBirth.toISOString().slice(0, 10);
  // Per the BSMODEL note, the card carries the child's info AND the parent's.
  // A guardian name/phone is basic ID + contact, not sensitive medical data —
  // so it stays consistent with NCIHAP §5 (nothing medical printed openly; the
  // QR still retrieves the vaccination schedule from the registry).
  const parent = input.caregiverName ? escapeXml(input.caregiverName) : '—';
  const parentPhone = input.caregiverPhone ? escapeXml(input.caregiverPhone) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="410" viewBox="0 0 640 410">
  <rect width="640" height="410" rx="16" fill="#0f3d2e"/>
  <rect x="8" y="8" width="624" height="394" rx="12" fill="#ffffff"/>
  <text x="32" y="52" font-family="Georgia, serif" font-size="22" font-weight="bold" fill="#0f3d2e">Child Health Assurance Card</text>
  <text x="32" y="76" font-family="Georgia, serif" font-size="13" fill="#4a5a52">Velaji prototype — not a national ID document</text>

  <text x="32" y="126" font-family="Georgia, serif" font-size="14" fill="#333">Child</text>
  <text x="32" y="150" font-family="Georgia, serif" font-size="20" font-weight="bold" fill="#0f3d2e">${escapeXml(input.fullName)}</text>
  <text x="32" y="172" font-family="Georgia, serif" font-size="12" fill="#333">DOB: ${dob}   Sex: ${escapeXml(input.sex)}</text>

  <text x="32" y="212" font-family="Georgia, serif" font-size="14" fill="#333">Child Health ID (CHIN)</text>
  <text x="32" y="236" font-family="Courier New, monospace" font-size="19" font-weight="bold" fill="#0f3d2e">${escapeXml(input.chin)}</text>

  <text x="32" y="282" font-family="Georgia, serif" font-size="14" fill="#333">Parent / Guardian</text>
  <text x="32" y="304" font-family="Georgia, serif" font-size="16" font-weight="bold" fill="#0f3d2e">${parent}</text>
  <text x="32" y="324" font-family="Georgia, serif" font-size="12" fill="#333">${parentPhone}</text>

  <text x="32" y="360" font-family="Georgia, serif" font-size="12" fill="#333">Home facility: ${escapeXml(input.facilityName)}</text>

  <image x="464" y="96" width="140" height="140" href="${qrDataUrl}"/>
  <text x="464" y="252" font-family="Georgia, serif" font-size="10" fill="#4a5a52">Scan QR for status &amp; schedule</text>
</svg>`;
}
