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
}): Promise<string> {
  const qrDataUrl = await generateQrPngDataUrl(input.chin);
  const dob = input.dateOfBirth.toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="380" viewBox="0 0 640 380">
  <rect width="640" height="380" rx="16" fill="#0f3d2e"/>
  <rect x="8" y="8" width="624" height="364" rx="12" fill="#ffffff"/>
  <text x="32" y="52" font-family="Georgia, serif" font-size="22" font-weight="bold" fill="#0f3d2e">Child Health Assurance Card</text>
  <text x="32" y="76" font-family="Georgia, serif" font-size="13" fill="#4a5a52">NCIHAP prototype — not a national ID document</text>

  <text x="32" y="130" font-family="Georgia, serif" font-size="15" fill="#333">Name</text>
  <text x="32" y="154" font-family="Georgia, serif" font-size="20" font-weight="bold" fill="#0f3d2e">${escapeXml(input.fullName)}</text>

  <text x="32" y="196" font-family="Georgia, serif" font-size="15" fill="#333">Child Health ID (CHIN)</text>
  <text x="32" y="220" font-family="Courier New, monospace" font-size="19" font-weight="bold" fill="#0f3d2e">${escapeXml(input.chin)}</text>

  <text x="32" y="262" font-family="Georgia, serif" font-size="13" fill="#333">DOB: ${dob}   Sex: ${escapeXml(input.sex)}</text>
  <text x="32" y="284" font-family="Georgia, serif" font-size="13" fill="#333">Home facility: ${escapeXml(input.facilityName)}</text>

  <image x="464" y="90" width="140" height="140" href="${qrDataUrl}"/>
  <text x="464" y="248" font-family="Georgia, serif" font-size="10" fill="#4a5a52">Scan to verify status</text>
</svg>`;
}
