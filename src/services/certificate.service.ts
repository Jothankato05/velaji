import crypto from 'crypto';
import { CertificateModel } from '../models/Certificate';
import type { ChildHydrated } from '../models/Child';
import { isScheduleComplete } from './schedule.service';

const COVERAGE_MONTHS = 12; // NCIHAP §12: complete immunisation → 12 months coverage

/**
 * If the child's schedule is now fully complete and no certificate exists yet,
 * issue one — and with it UNLOCK the NHIA "Healthy Start" health coverage
 * window (NCIHAP §12). This is the payoff of the whole programme: finishing
 * immunisation converts into sponsored child health coverage.
 */
export async function maybeIssueCertificate(child: ChildHydrated): Promise<void> {
  const complete = isScheduleComplete(
    child.doses.map((d) => ({
      vaccineCode: d.vaccineCode,
      displayName: d.displayName,
      doseNumber: d.doseNumber,
      dueDate: d.dueDate,
      administeredDate: d.administeredDate ?? null
    }))
  );

  if (!complete) return;

  const existing = await CertificateModel.findOne({ childId: child._id });
  if (existing) return;

  const issuedAt = new Date();
  const coverageExpiresAt = new Date(issuedAt);
  coverageExpiresAt.setMonth(coverageExpiresAt.getMonth() + COVERAGE_MONTHS);

  await CertificateModel.create({
    childId: child._id,
    chin: child.chin,
    verificationCode: crypto.randomBytes(9).toString('base64url'),
    issuedAt,
    coverageProgramme: 'Healthy Start',
    coverageMonths: COVERAGE_MONTHS,
    coverageStartsAt: issuedAt,
    coverageExpiresAt
  });
}
