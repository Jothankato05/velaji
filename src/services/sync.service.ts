import mongoose from 'mongoose';
import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { SyncTransactionModel } from '../models/SyncTransaction';
import { generateChin, normalizeChin } from './chin.service';
import { buildDosesForChild, computeChildStatus } from './schedule.service';
import { maybeIssueCertificate } from './certificate.service';
import { autoResolveForDose } from './escalation.service';
import { AppError } from '../utils/AppError';

export interface Requester {
  username: string;
}

// --- Pull: seed / refresh a device's local store (NCIHAP §9 item 1) ---

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function pullChanges(facilityId: string, since?: string) {
  if (!mongoose.isValidObjectId(facilityId)) throw new AppError('facilityId must be a valid id', 400);

  const query: Record<string, unknown> = {
    $or: [{ currentFacilityId: facilityId }, { homeFacilityId: facilityId }]
  };
  if (since) {
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) throw new AppError('since must be an ISO timestamp', 400);
    query.updatedAt = { $gt: sinceDate };
  }

  const children = await ChildModel.find(query).sort({ updatedAt: 1 });
  const serverTime = new Date().toISOString();

  const snapshots = [];
  for (const c of children) {
    const caregiver = await CaregiverModel.findById(c.caregiverId);
    const doses = c.doses.map((d) => ({
      vaccineCode: d.vaccineCode,
      displayName: d.displayName,
      doseNumber: d.doseNumber,
      dueDate: d.dueDate,
      administeredDate: d.administeredDate ?? null
    }));
    snapshots.push({
      chin: c.chin,
      fullName: c.fullName,
      sex: c.sex,
      dateOfBirth: c.dateOfBirth,
      currentFacilityId: c.currentFacilityId,
      caregiver: caregiver ? { fullName: caregiver.fullName, phone: caregiver.phone || null } : null,
      doses,
      status: computeChildStatus(doses, { needsReconciliation: c.needsReconciliation }),
      needsReconciliation: c.needsReconciliation,
      completedAt: c.completedAt ?? null,
      updatedAt: (c as unknown as { updatedAt: Date }).updatedAt
    });
  }

  // The device stores serverTime and passes it back as `since` next pull, so
  // it only ever downloads what changed.
  return { serverTime, count: snapshots.length, children: snapshots };
}

// --- Push: apply transactions recorded while offline (NCIHAP §9 items 2–5) ---

type TxResult = { result: 'applied' | 'duplicate' | 'conflict' | 'error'; chin?: string; detail?: string };

interface IncomingTx {
  clientTxId?: string;
  type?: string;
  recordedAt?: string;
  payload?: any;
}

async function applyRecordDose(tx: IncomingTx): Promise<TxResult> {
  const p = tx.payload ?? {};
  if (!p.chin || !p.vaccineCode || p.doseNumber === undefined || !p.facilityId) {
    return { result: 'error', detail: 'record_dose needs chin, vaccineCode, doseNumber, facilityId' };
  }
  const chin = normalizeChin(String(p.chin));
  const child = await ChildModel.findOne({ chin });
  if (!child) return { result: 'error', chin, detail: `no child with CHIN ${chin}` };

  const dose = child.doses.find((d) => d.vaccineCode === p.vaccineCode && d.doseNumber === Number(p.doseNumber));
  if (!dose) return { result: 'error', chin, detail: `no scheduled dose ${p.vaccineCode}#${p.doseNumber}` };

  const recordedAt = tx.recordedAt ? new Date(tx.recordedAt) : new Date();

  if (dose.administeredDate) {
    const sameFacility = String(dose.administeredAtFacilityId) === String(p.facilityId);
    const sameDay = dayKey(dose.administeredDate) === dayKey(recordedAt);
    // Same facility, same day → both devices recorded the same real event.
    if (sameFacility && sameDay) {
      return { result: 'duplicate', chin, detail: 'dose already recorded (same facility, same day)' };
    }
    // Otherwise two sources disagree. Keep the EARLIER administration (the true
    // first vaccination) and flag the record for human reconciliation — which
    // is exactly what GREY means (NCIHAP §10).
    if (recordedAt < dose.administeredDate) {
      dose.administeredDate = recordedAt;
      dose.administeredAtFacilityId = p.facilityId;
    }
    child.needsReconciliation = true;
    await child.save();
    return { result: 'conflict', chin, detail: 'dose recorded by another source, flagged for reconciliation (GREY)' };
  }

  dose.administeredDate = recordedAt;
  dose.administeredAtFacilityId = p.facilityId;
  if (child.doses.every((d) => d.administeredDate) && !child.completedAt) {
    child.completedAt = new Date();
  }
  await child.save();
  await maybeIssueCertificate(child);
  await autoResolveForDose(child._id, `${p.vaccineCode}#${Number(p.doseNumber)}`);
  return { result: 'applied', chin };
}

async function applyRegisterChild(tx: IncomingTx): Promise<TxResult> {
  const p = tx.payload ?? {};
  if (!p.fullName || !p.sex || !p.dateOfBirth || !p.homeFacilityId) {
    return { result: 'error', detail: 'register_child needs fullName, sex, dateOfBirth, homeFacilityId' };
  }
  const dob = new Date(p.dateOfBirth);
  if (Number.isNaN(dob.getTime())) return { result: 'error', detail: 'dateOfBirth is not a valid date' };

  let caregiverId = p.caregiverId;
  if (!caregiverId) {
    const cg = await CaregiverModel.create({
      fullName: p.caregiver?.fullName ?? 'Unknown caregiver',
      phone: p.caregiver?.phone ?? ''
    });
    caregiverId = cg._id;
  }

  let chin = generateChin();
  for (let attempt = 0; attempt < 5 && (await ChildModel.exists({ chin })); attempt++) {
    chin = generateChin();
  }

  await ChildModel.create({
    chin,
    fullName: p.fullName,
    sex: p.sex,
    dateOfBirth: dob,
    caregiverId,
    homeFacilityId: p.homeFacilityId,
    currentFacilityId: p.homeFacilityId,
    doses: buildDosesForChild(dob)
  });
  // The device made up a temporary local id; return the real CHIN so it can
  // reconcile its local record.
  return { result: 'applied', chin };
}

export async function pushTransactions(deviceId: string, transactions: IncomingTx[], requester: Requester) {
  if (!Array.isArray(transactions)) throw new AppError('transactions must be an array', 400);

  const results: Array<{ clientTxId: string; result: TxResult['result']; chin?: string; detail?: string }> = [];
  const tally = { applied: 0, duplicate: 0, conflict: 0, error: 0 };

  for (const tx of transactions) {
    if (!tx.clientTxId || !tx.type) {
      results.push({ clientTxId: tx.clientTxId ?? '(missing)', result: 'error', detail: 'missing clientTxId or type' });
      tally.error += 1;
      continue;
    }

    // Idempotency: a replay of an already-processed transaction returns the
    // original outcome and changes nothing.
    const seen = await SyncTransactionModel.findOne({ clientTxId: tx.clientTxId });
    if (seen) {
      results.push({ clientTxId: tx.clientTxId, result: 'duplicate', chin: seen.chin || undefined, detail: `already ${seen.result}` });
      tally.duplicate += 1;
      continue;
    }

    let outcome: TxResult;
    try {
      if (tx.type === 'record_dose') outcome = await applyRecordDose(tx);
      else if (tx.type === 'register_child') outcome = await applyRegisterChild(tx);
      else outcome = { result: 'error', detail: `unknown transaction type "${tx.type}"` };
    } catch (error) {
      outcome = { result: 'error', detail: (error as Error).message };
    }

    await SyncTransactionModel.create({
      clientTxId: tx.clientTxId,
      deviceId,
      type: tx.type,
      payload: tx.payload ?? {},
      recordedAt: tx.recordedAt ? new Date(tx.recordedAt) : new Date(),
      receivedAt: new Date(),
      result: outcome.result,
      appliedBy: requester.username,
      chin: outcome.chin ?? '',
      detail: outcome.detail ?? ''
    });

    results.push({ clientTxId: tx.clientTxId, result: outcome.result, chin: outcome.chin, detail: outcome.detail });
    tally[outcome.result] += 1;
  }

  return { processed: transactions.length, ...tally, results };
}
