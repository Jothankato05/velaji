import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { ReminderLogModel } from '../models/ReminderLog';
import { EscalationModel } from '../models/Escalation';
import type { Types } from 'mongoose';
import { getSmsProvider } from '../providers/sms';
import type { SmsProvider } from '../providers/sms';
import { computeDoseStatus } from './schedule.service';
import { buildReminderSms } from './reminder-content';
import { env } from '../config/env';

type EscalationReason = 'max_attempts' | 'lost_to_followup';

export interface ReminderCycleSummary {
  scannedChildren: number;
  remindableChildren: number;
  sent: number;
  failed: number;
  skippedCooldown: number;
  skippedMaxAttempts: number;
  skippedNoPhone: number;
  quietHoursSkipped: boolean;
  /** `${chin} ${doseKey}` for doses that hit the attempt cap or went GREY —
   *  these need a human to trace the family, not another SMS. */
  escalations: string[];
}

export interface ReminderServiceOptions {
  childModel?: typeof ChildModel;
  caregiverModel?: typeof CaregiverModel;
  facilityModel?: typeof FacilityModel;
  reminderLogModel?: typeof ReminderLogModel;
  escalationModel?: typeof EscalationModel;
  smsProvider?: SmsProvider;
  now?: () => Date;
  cooldownHours?: number;
  maxPerDose?: number;
  sendStartHour?: number;
  sendEndHour?: number;
}

const HOUR_MS = 60 * 60 * 1000;

function withinSendWindow(hour: number, start: number, end: number): boolean {
  // Support a wrapping window (e.g. 20 -> 6) as well as a normal one (8 -> 20).
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export class ReminderService {
  private childModel: typeof ChildModel;
  private caregiverModel: typeof CaregiverModel;
  private facilityModel: typeof FacilityModel;
  private reminderLogModel: typeof ReminderLogModel;
  private escalationModel: typeof EscalationModel;
  private smsProvider: SmsProvider;
  private now: () => Date;
  private cooldownHours: number;
  private maxPerDose: number;
  private sendStartHour: number;
  private sendEndHour: number;

  constructor(options: ReminderServiceOptions = {}) {
    this.childModel = options.childModel ?? ChildModel;
    this.caregiverModel = options.caregiverModel ?? CaregiverModel;
    this.facilityModel = options.facilityModel ?? FacilityModel;
    this.reminderLogModel = options.reminderLogModel ?? ReminderLogModel;
    this.escalationModel = options.escalationModel ?? EscalationModel;
    this.smsProvider = options.smsProvider ?? getSmsProvider();
    this.now = options.now ?? (() => new Date());
    this.cooldownHours = options.cooldownHours ?? env.REMINDER_COOLDOWN_HOURS;
    this.maxPerDose = options.maxPerDose ?? env.REMINDER_MAX_PER_DOSE;
    this.sendStartHour = options.sendStartHour ?? env.REMINDER_SEND_START_HOUR;
    this.sendEndHour = options.sendEndHour ?? env.REMINDER_SEND_END_HOUR;
  }

  /**
   * Raise (or refresh) an open escalation for one child+dose. Idempotent:
   * the partial unique index means re-asserting the same escalation each
   * cycle just updates lastSeenAt/reason instead of creating duplicates.
   */
  private async recordEscalation(
    child: { _id: Types.ObjectId; chin: string },
    doseKey: string,
    reason: EscalationReason,
    remindersSent: number,
    now: Date
  ): Promise<void> {
    await this.escalationModel.findOneAndUpdate(
      { childId: child._id, doseKey, status: 'open' },
      {
        $set: { reason, remindersSent, lastSeenAt: now },
        $setOnInsert: { childId: child._id, chin: child.chin, doseKey, status: 'open', raisedAt: now }
      },
      { upsert: true }
    );
  }

  async runCycle(): Promise<ReminderCycleSummary> {
    const now = this.now();
    const summary: ReminderCycleSummary = {
      scannedChildren: 0,
      remindableChildren: 0,
      sent: 0,
      failed: 0,
      skippedCooldown: 0,
      skippedMaxAttempts: 0,
      skippedNoPhone: 0,
      quietHoursSkipped: false,
      escalations: []
    };

    if (!withinSendWindow(now.getHours(), this.sendStartHour, this.sendEndHour)) {
      summary.quietHoursSkipped = true;
      return summary;
    }

    // Only children who still have doses outstanding.
    const children = await this.childModel.find({ completedAt: null });
    summary.scannedChildren = children.length;

    for (const child of children) {
      const caregiver = await this.caregiverModel.findById(child.caregiverId);
      const facility = await this.facilityModel.findById(child.currentFacilityId);
      const facilityName = facility?.name ?? 'your health facility';

      // Collect this child's outstanding doses by category. A caregiver gets
      // at most ONE text per cycle (about their most-overdue vaccine) rather
      // than one per dose — 12 texts at once is spam, and expensive on a real
      // gateway. Per-dose cooldown/cap still applies, keyed to that dose.
      const remindable: { doseKey: string; displayName: string; dueDate: Date; status: 'AMBER' | 'RED' }[] = [];

      for (const dose of child.doses) {
        if (dose.administeredDate) continue;
        const status = computeDoseStatus(dose.dueDate, now);
        if (status === 'GREEN') continue; // not due yet
        const doseKey = `${dose.vaccineCode}#${dose.doseNumber}`;
        remindable.push({ doseKey, displayName: dose.displayName, dueDate: dose.dueDate, status });
      }

      if (remindable.length === 0) continue;

      summary.remindableChildren += 1;

      // Most overdue (earliest due date) leads the message.
      remindable.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      const lead = remindable[0];

      if (!caregiver?.phone) {
        // No way to reach the caregiver by SMS. An overdue (RED) child in this
        // state can't be recovered by reminders — it's a continued-default case
        // for the follow-up queue (NCIHAP §7). A merely due-soon (AMBER) child
        // isn't overdue yet, so just note we couldn't remind.
        if (lead.status === 'RED') {
          await this.recordEscalation(child, lead.doseKey, 'lost_to_followup', 0, now);
          summary.escalations.push(`${child.chin} ${lead.doseKey}`);
        }
        summary.skippedNoPhone += 1;
        continue;
      }

      const priorSends = await this.reminderLogModel
        .find({ childId: child._id, doseKey: lead.doseKey, status: 'sent' })
        .sort({ sentAt: -1 });

      if (priorSends.length >= this.maxPerDose) {
        // Reminded to the cap and still due — continued default (NCIHAP §7).
        // Hand to the follow-up queue for PHC/community-health intervention.
        summary.skippedMaxAttempts += 1;
        await this.recordEscalation(child, lead.doseKey, 'max_attempts', priorSends.length, now);
        summary.escalations.push(`${child.chin} ${lead.doseKey}`);
        continue;
      }

      const lastSend = priorSends[0];
      if (lastSend && now.getTime() - lastSend.sentAt.getTime() < this.cooldownHours * HOUR_MS) {
        summary.skippedCooldown += 1;
        continue;
      }

      const body = buildReminderSms({
        childName: child.fullName,
        caregiverName: caregiver.fullName,
        vaccineName: lead.displayName,
        dueDate: lead.dueDate,
        status: lead.status,
        facilityName,
        additionalDueCount: remindable.length - 1
      });

      const result = await this.smsProvider.send({ to: caregiver.phone, body });

      await this.reminderLogModel.create({
        childId: child._id,
        chin: child.chin,
        doseKey: lead.doseKey,
        channel: 'sms',
        to: caregiver.phone,
        body,
        status: result.ok ? 'sent' : 'failed',
        providerName: this.smsProvider.name,
        providerMessageId: result.providerMessageId,
        error: result.error ?? null,
        sentAt: now
      });

      if (result.ok) summary.sent += 1;
      else summary.failed += 1;
    }

    return summary;
  }
}

export const reminderService = new ReminderService();
