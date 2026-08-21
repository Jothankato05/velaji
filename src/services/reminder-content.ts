import type { DoseStatusColor } from './schedule.service';

export interface ReminderContentInput {
  childName: string;
  caregiverName: string;
  vaccineName: string;
  dueDate: Date;
  status: DoseStatusColor; // AMBER (due soon) or RED (overdue)
  facilityName: string;
  /** How many OTHER doses are also due for this child right now, if any. */
  additionalDueCount?: number;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The actual SMS text a caregiver receives. Kept short (SMS length matters and
 * costs money per segment), names the child and vaccine specifically, and says
 * where to go. No PII beyond the child's first name and the vaccine — a lost
 * phone shouldn't leak a full record.
 */
export function buildReminderSms(input: ReminderContentInput): string {
  const firstName = input.childName.split(' ')[0];
  const extra =
    input.additionalDueCount && input.additionalDueCount > 0
      ? ` (${input.additionalDueCount} other vaccine${input.additionalDueCount > 1 ? 's are' : ' is'} also due)`
      : '';

  if (input.status === 'RED') {
    return (
      `Hello ${input.caregiverName}. ${firstName}'s ${input.vaccineName} vaccine was due on ` +
      `${formatDate(input.dueDate)} and is now overdue${extra}. Please visit ${input.facilityName} soon. ` +
      `It is free and protects your child.`
    );
  }

  return (
    `Hello ${input.caregiverName}. ${firstName}'s ${input.vaccineName} vaccine is due on ` +
    `${formatDate(input.dueDate)}${extra}. Please visit ${input.facilityName}. It is free and protects your child.`
  );
}
