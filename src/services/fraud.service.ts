import { DoseAdministrationModel } from '../models/DoseAdministration';
import type { StaffRole } from '../utils/token';

const MINUTE = 60 * 1000;

// Thresholds for "impossible" throughput by a single worker (NCIHAP §17). Real
// vaccination takes minutes per child; recording far more than this in a tight
// window is a data-integrity signal worth a human look, not an auto-accusation.
export const VELOCITY_WINDOW_MINUTES = 10;
export const VELOCITY_MAX_IN_WINDOW = 25;
export const DUPLICATE_ALERT_THRESHOLD = 3;

export interface AdministrationEvent {
  chin: string;
  childId: any;
  vaccineCode: string;
  doseNumber: number;
  facilityId?: any;
  recordedBy: string;
  recordedByRole: StaffRole | 'system';
  duplicate?: boolean;
  recordedAt?: Date;
}

/** Append one dose-recording event to the ledger. Best-effort: a ledger write
 *  must never break the clinical action, so callers wrap it defensively. */
export async function recordAdministration(event: AdministrationEvent): Promise<void> {
  await DoseAdministrationModel.create({
    chin: event.chin,
    childId: event.childId,
    vaccineCode: event.vaccineCode,
    doseNumber: event.doseNumber,
    facilityId: event.facilityId ?? null,
    recordedBy: event.recordedBy,
    recordedByRole: event.recordedByRole,
    duplicate: Boolean(event.duplicate),
    recordedAt: event.recordedAt ?? new Date()
  });
}

export type IntegrityAlertKind = 'velocity' | 'duplicates';

export interface IntegrityAlert {
  kind: IntegrityAlertKind;
  worker: string;
  role: string;
  count: number;
  detail: string;
  at: string;
}

/**
 * Scan the administration ledger for the two patterns §17 calls out:
 *   - velocity: a worker recording more than VELOCITY_MAX_IN_WINDOW genuine
 *     doses within any VELOCITY_WINDOW_MINUTES window (impossible throughput);
 *   - duplicates: a worker with repeated duplicate-dose attempts.
 * Worst-first. Returns counts + who, never an automatic judgement.
 */
export async function detectIntegrityAlerts(now: Date = new Date(), lookbackDays = 30): Promise<IntegrityAlert[]> {
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * MINUTE);
  const events = await DoseAdministrationModel.find({ recordedAt: { $gte: since } }).sort({ recordedAt: 1 });

  const byWorker = new Map<string, { role: string; genuine: Date[]; duplicates: number }>();
  for (const e of events) {
    const w = byWorker.get(e.recordedBy) ?? { role: e.recordedByRole, genuine: [], duplicates: 0 };
    if (e.duplicate) w.duplicates += 1;
    else w.genuine.push(e.recordedAt);
    byWorker.set(e.recordedBy, w);
  }

  const alerts: IntegrityAlert[] = [];
  const windowMs = VELOCITY_WINDOW_MINUTES * MINUTE;

  for (const [worker, w] of byWorker) {
    // Sliding window over the sorted timestamps: the largest count within any
    // VELOCITY_WINDOW_MINUTES span.
    let start = 0;
    let peak = 0;
    let peakAt: Date | null = null;
    for (let end = 0; end < w.genuine.length; end++) {
      while (w.genuine[end].getTime() - w.genuine[start].getTime() > windowMs) start++;
      const span = end - start + 1;
      if (span > peak) {
        peak = span;
        peakAt = w.genuine[end];
      }
    }
    if (peak > VELOCITY_MAX_IN_WINDOW) {
      alerts.push({
        kind: 'velocity',
        worker,
        role: w.role,
        count: peak,
        detail: `${peak} doses recorded within ${VELOCITY_WINDOW_MINUTES} minutes, above the ${VELOCITY_MAX_IN_WINDOW} plausible-throughput threshold`,
        at: (peakAt ?? now).toISOString()
      });
    }
    if (w.duplicates >= DUPLICATE_ALERT_THRESHOLD) {
      alerts.push({
        kind: 'duplicates',
        worker,
        role: w.role,
        count: w.duplicates,
        detail: `${w.duplicates} duplicate-dose attempts: the same dose recorded again after it was already given`,
        at: now.toISOString()
      });
    }
  }

  return alerts.sort((a, b) => b.count - a.count);
}
