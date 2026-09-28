import type { Types } from 'mongoose';
import { EscalationModel } from '../models/Escalation';
import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { AppError } from '../utils/AppError';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EscalationView {
  id: string;
  chin: string;
  childName: string;
  caregiverName: string | null;
  caregiverPhone: string | null;
  facilityName: string | null;
  vaccine: string;
  doseKey: string;
  reason: string;
  reasonLabel: string;
  remindersSent: number;
  daysOverdue: number | null;
  raisedAt: Date;
  status: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  outcome: string | null;
  barrier: string | null;
  barrierLabel: string | null;
  resolutionNote: string;
}

const REASON_LABEL: Record<string, string> = {
  max_attempts: 'Reminded to the limit; caregiver not responding',
  lost_to_followup: 'Overdue and unreachable; needs tracing'
};

/** The documented Nigerian drivers of defaulting / zero-dose (WHO, NPHCDA,
 *  peer-reviewed surveys) — the categories a worker records on tracing. */
export const BARRIER_LABELS: Record<string, string> = {
  hesitancy: 'Vaccine hesitancy / refusal',
  distance: 'Distance / access',
  insecurity: 'Insecurity',
  financial: 'Financial / poverty',
  unaware: 'Unaware / forgot',
  no_session: 'No session / stockout',
  other: 'Other'
};
export const BARRIERS = Object.keys(BARRIER_LABELS);

/**
 * The queue a health worker actually works from: each open escalation enriched
 * with who the child is, how to reach the caregiver, which vaccine, and how
 * overdue it is — everything needed to go trace the family, in one row.
 */
export async function countOpenEscalations(): Promise<number> {
  return EscalationModel.countDocuments({ status: 'open' });
}

export async function listEscalations(status: 'open' | 'resolved' = 'open'): Promise<EscalationView[]> {
  const escalations = await EscalationModel.find({ status }).sort({ raisedAt: 1 });
  const now = Date.now();

  const views: EscalationView[] = [];
  for (const esc of escalations) {
    const child = await ChildModel.findById(esc.childId);
    const caregiver = child ? await CaregiverModel.findById(child.caregiverId) : null;
    const facility = child ? await FacilityModel.findById(child.currentFacilityId) : null;

    // Find the specific dose this escalation is about to report the vaccine
    // name and how overdue it is.
    const [vaccineCode, doseNumberRaw] = esc.doseKey.split('#');
    const dose = child?.doses.find(
      (d) => d.vaccineCode === vaccineCode && d.doseNumber === Number(doseNumberRaw)
    );

    views.push({
      id: String(esc._id),
      chin: esc.chin,
      childName: child?.fullName ?? '(child record missing)',
      caregiverName: caregiver?.fullName ?? null,
      caregiverPhone: caregiver?.phone ?? null,
      facilityName: facility?.name ?? null,
      vaccine: dose?.displayName ?? vaccineCode,
      doseKey: esc.doseKey,
      reason: esc.reason,
      reasonLabel: REASON_LABEL[esc.reason] ?? esc.reason,
      remindersSent: esc.remindersSent,
      daysOverdue: dose ? Math.max(0, Math.floor((now - dose.dueDate.getTime()) / DAY_MS)) : null,
      raisedAt: esc.raisedAt,
      status: esc.status,
      resolvedAt: esc.resolvedAt ?? null,
      resolvedBy: esc.resolvedBy ?? null,
      outcome: esc.outcome ?? null,
      barrier: esc.barrier ?? null,
      barrierLabel: esc.barrier ? BARRIER_LABELS[esc.barrier] ?? esc.barrier : null,
      resolutionNote: esc.resolutionNote ?? ''
    });
  }

  // Open cases: longest overdue first, the order they should be traced in.
  // Resolved: most recently closed first.
  return status === 'open'
    ? views.sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1))
    : views.sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0));
}

export async function resolveEscalation(
  id: string,
  resolvedBy: string,
  outcome: string | null,
  note: string,
  barrier: string | null = null
) {
  const escalation = await EscalationModel.findById(id);
  if (!escalation) throw new AppError('Escalation not found', 404);
  if (escalation.status === 'resolved') throw new AppError('Escalation is already resolved', 409);
  // "Immunized" must match the child's record. The case closes itself when the
  // dose is recorded, so claiming it by hand while the dose is still missing
  // would leave the queue and the record disagreeing.
  if (outcome === 'immunized') {
    const child = await ChildModel.findById(escalation.childId);
    const [code, num] = escalation.doseKey.split('#');
    const dose = child?.doses.find((d) => d.vaccineCode === code && d.doseNumber === Number(num));
    if (!dose?.administeredDate) {
      throw new AppError('This vaccine is not recorded yet. Record it at point of care and the case closes by itself.', 409);
    }
  }

  escalation.status = 'resolved';
  escalation.resolvedAt = new Date();
  escalation.resolvedBy = resolvedBy;
  escalation.outcome = (outcome as typeof escalation.outcome) ?? 'other';
  escalation.barrier = (barrier as typeof escalation.barrier) ?? null;
  escalation.resolutionNote = note ?? '';
  await escalation.save();

  return escalation;
}

/**
 * Why children are being missed, in aggregate (NCIHAP §11 intelligence): the
 * barriers recorded on resolved escalations, most common first. Grounds the
 * national picture in the real drivers — so intervention (demand-generation for
 * hesitancy, outreach for distance, security-window planning for insecurity)
 * can be matched to the reason, not guessed.
 */
export async function defaultingReasons(): Promise<{ total: number; reasons: Array<{ barrier: string; label: string; count: number }> }> {
  const resolved = await EscalationModel.find({ status: 'resolved', barrier: { $ne: null } });
  const counts = new Map<string, number>();
  for (const e of resolved) {
    if (!e.barrier) continue;
    counts.set(e.barrier, (counts.get(e.barrier) ?? 0) + 1);
  }
  return {
    total: [...counts.values()].reduce((a, b) => a + b, 0),
    reasons: [...counts.entries()]
      .map(([barrier, count]) => ({ barrier, label: BARRIER_LABELS[barrier] ?? barrier, count }))
      .sort((a, b) => b.count - a.count)
  };
}

/**
 * When a dose is finally recorded, close any open escalation for that exact
 * child+dose automatically — the reason it was escalated no longer exists.
 * Called from the record-dose flow so the queue stays honest without a human
 * having to tick it off.
 */
export async function autoResolveForDose(childId: Types.ObjectId, doseKey: string): Promise<void> {
  await EscalationModel.updateMany(
    { childId, doseKey, status: 'open' },
    {
      $set: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: 'system',
        outcome: 'immunized',
        resolutionNote: 'Dose recorded, auto-resolved.'
      }
    }
  );
}
