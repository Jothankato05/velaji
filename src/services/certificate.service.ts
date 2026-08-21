import crypto from 'crypto';
import { CertificateModel } from '../models/Certificate';
import type { ChildHydrated } from '../models/Child';
import { isScheduleComplete } from './schedule.service';

/**
 * If the child's schedule is now fully complete and no certificate exists
 * yet, issue one. This is intentionally just a completion flag + a
 * verification code — see Certificate model comment for why it stops there.
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

  await CertificateModel.create({
    childId: child._id,
    chin: child.chin,
    verificationCode: crypto.randomBytes(9).toString('base64url'),
    issuedAt: new Date()
  });
}
