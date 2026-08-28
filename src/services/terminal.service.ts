import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { AccessLogModel } from '../models/AccessLog';
import { normalizeChin, isValidChinFormat } from '../services/chin.service';
import { verifyChinToken } from '../services/verification-token.service';
import { computeChildStatus, type ChildStatusColor } from '../services/schedule.service';
import { AppError } from '../utils/AppError';
import type { StaffRole } from '../utils/token';

export interface Requester {
  username: string;
  role: StaffRole;
}

export type LookupMethod = 'chin' | 'qr';
export type StatusHeadline = 'CURRENT' | 'ATTENTION REQUIRED';

export interface TerminalLookupResult {
  headline: StatusHeadline;
  status: ChildStatusColor;
  method: LookupMethod;
  tier: StaffRole;
  record: Record<string, unknown>;
}

/**
 * NCIHAP §16: an authorised worker scans the QR or enters the CHIN and the
 * system returns "CURRENT" / "ATTENTION REQUIRED" plus only what the person is
 * authorised to see (§24 least-privilege). GREEN/BLUE read as CURRENT;
 * anything needing action (AMBER/RED/GREY) reads as ATTENTION REQUIRED.
 */
function toHeadline(status: ChildStatusColor): StatusHeadline {
  return status === 'GREEN' || status === 'BLUE' ? 'CURRENT' : 'ATTENTION REQUIRED';
}

/**
 * Resolve the CHIN from a lookup input. Either the worker typed the CHIN, or
 * scanned the QR (which encodes the signed verification URL). The QR path
 * additionally proves the physical card is genuine via the signed token.
 */
function resolveChin(input: { chin?: string; qr?: string }): { chin: string; method: LookupMethod } {
  if (input.qr) {
    let chin: string | null = null;
    let token: string | null = null;
    try {
      const url = new URL(input.qr);
      const seg = url.pathname.split('/').filter(Boolean).pop();
      chin = seg ? decodeURIComponent(seg) : null;
      token = url.searchParams.get('t');
    } catch {
      throw new AppError('QR content is not a valid verification code', 400);
    }
    if (!chin || !token) throw new AppError('QR content is missing the CHIN or token', 400);
    const normalized = normalizeChin(chin);
    if (!verifyChinToken(normalized, token)) {
      throw new AppError('QR verification token is invalid; the card may be forged', 401);
    }
    return { chin: normalized, method: 'qr' };
  }

  if (input.chin) {
    const normalized = normalizeChin(input.chin);
    // The Luhn check catches a mistyped CHIN before it silently points at
    // the wrong child (or nothing).
    if (!isValidChinFormat(normalized)) {
      throw new AppError('That CHIN is not valid; check for a typo', 400);
    }
    return { chin: normalized, method: 'chin' };
  }

  throw new AppError('Provide either a CHIN (typed) or a QR (scanned)', 400);
}

export async function terminalLookup(
  input: { chin?: string; qr?: string },
  requester: Requester,
  now: Date = new Date()
): Promise<TerminalLookupResult> {
  const { chin, method } = resolveChin(input);
  const child = await ChildModel.findOne({ chin });

  if (!child) {
    await AccessLogModel.create({
      chin,
      childId: null,
      accessedBy: requester.username,
      accessorRole: requester.role,
      method,
      tier: requester.role,
      outcome: 'not_found',
      at: now
    });
    throw new AppError(`No child found with CHIN ${chin}`, 404);
  }

  const doses = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode,
    displayName: d.displayName,
    doseNumber: d.doseNumber,
    dueDate: d.dueDate,
    administeredDate: d.administeredDate ?? null
  }));
  const status = computeChildStatus(doses, { now, needsReconciliation: child.needsReconciliation });
  const nextDue = doses
    .filter((d) => !d.administeredDate)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  // --- Role-scoped disclosure (NCIHAP §24 least-privilege) ---
  // Everyone authorised sees the §16 headline + who they're looking at.
  const base: Record<string, unknown> = {
    chin: child.chin,
    childName: child.fullName,
    status,
    statusHeadline: toHeadline(status),
    nextDue: nextDue ? { vaccine: nextDue.displayName, dueDate: nextDue.dueDate } : null
  };

  let record: Record<string, unknown>;
  if (requester.role === 'verifier') {
    // Minimal tier: confirm identity + status only. No history, DOB, or contact.
    record = base;
  } else {
    // Health worker / admin: the record needed to continue care and follow up.
    const caregiver = await CaregiverModel.findById(child.caregiverId);
    const facility = await FacilityModel.findById(child.currentFacilityId);
    record = {
      ...base,
      sex: child.sex,
      dateOfBirth: child.dateOfBirth,
      currentFacility: facility?.name ?? null,
      caregiver: caregiver ? { fullName: caregiver.fullName, phone: caregiver.phone || null } : null,
      doses,
      completedAt: child.completedAt ?? null
    };
  }

  await AccessLogModel.create({
    chin: child.chin,
    childId: child._id,
    accessedBy: requester.username,
    accessorRole: requester.role,
    method,
    tier: requester.role,
    outcome: 'ok',
    at: now
  });

  return { headline: toHeadline(status), status, method, tier: requester.role, record };
}

export async function getAccessLog(chinInput: string) {
  const chin = normalizeChin(chinInput);
  return AccessLogModel.find({ chin }).sort({ at: -1 });
}
