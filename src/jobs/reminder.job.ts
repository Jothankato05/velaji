import { env } from '../config/env';
import { reminderService } from '../services/reminder.service';

let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const summary = await reminderService.runCycle();
    if (summary.quietHoursSkipped) {
      // eslint-disable-next-line no-console
      console.log('[reminder] outside send window, skipping this cycle');
      return;
    }
    if (summary.sent > 0 || summary.failed > 0 || summary.escalations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[reminder] scanned=${summary.scannedChildren} due=${summary.remindableChildren} ` +
          `sent=${summary.sent} failed=${summary.failed} cooldown=${summary.skippedCooldown} ` +
          `maxed=${summary.skippedMaxAttempts} noPhone=${summary.skippedNoPhone} ` +
          `escalations=${summary.escalations.length}`
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[reminder] cycle failed:', error);
  }
}

export function startReminderJob(): void {
  if (!env.REMINDER_ENGINE_ENABLED) {
    // eslint-disable-next-line no-console
    console.log('[reminder] engine DISABLED (set REMINDER_ENGINE_ENABLED=true to enable).');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[reminder] engine ENABLED — every ${env.REMINDER_SCAN_INTERVAL_MINUTES}m, ` +
      `cooldown ${env.REMINDER_COOLDOWN_HOURS}h, max ${env.REMINDER_MAX_PER_DOSE}/dose, ` +
      `window ${env.REMINDER_SEND_START_HOUR}:00-${env.REMINDER_SEND_END_HOUR}:00, provider=${env.SMS_PROVIDER}`
  );

  // Run once at boot so a restart doesn't leave a full interval of silence.
  void runOnce();

  timer = setInterval(() => void runOnce(), env.REMINDER_SCAN_INTERVAL_MINUTES * 60 * 1000);
  timer.unref();
}

export function stopReminderJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
