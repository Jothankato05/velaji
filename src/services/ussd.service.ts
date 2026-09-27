import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { computeChildStatus } from './schedule.service';
import { computeMilestones, nextMilestone } from './milestone.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * USSD access (NCIHAP §8): a caregiver on a basic phone dials a short code and
 * gets the same critical information a smartphone parent sees — child status,
 * the next vaccine and where, and reward progress — without typing a CHIN on a
 * numeric keypad. The caller is identified by their phone number (the same
 * number the reminder engine already texts), so there's nothing to remember.
 *
 * Session model: the gateway accumulates the user's key presses into `text`,
 * joined by `*`. We return `{ message, continue }`; the controller prefixes
 * CON (expect more input) or END (session over).
 */
export interface UssdResult {
  message: string;
  continue: boolean;
}

function firstNameOf(fullName: string): string {
  return fullName.split(' ')[0];
}

function statusHeadline(status: string): string {
  if (status === 'GREEN') return 'On track';
  if (status === 'BLUE') return 'Fully protected';
  if (status === 'AMBER') return 'Vaccine due soon';
  if (status === 'RED') return 'Action needed';
  return 'Needs review';
}

export async function handleUssd(input: { phoneNumber: string; text: string }, now: Date = new Date()): Promise<UssdResult> {
  const phone = (input.phoneNumber ?? '').replace(/\s+/g, '');
  const steps = input.text ? input.text.split('*') : [];

  const caregivers = await CaregiverModel.find({ phone });
  const children = caregivers.length
    ? await ChildModel.find({ caregiverId: { $in: caregivers.map((c) => c._id) } })
    : [];

  if (children.length === 0) {
    return { message: 'No child is registered to this phone number.\nVisit your nearest health centre to register.', continue: false };
  }

  // Pick the child. One child → straight in; several → a numbered menu first.
  let child = children[0];
  let menuStep: string | undefined = steps[0];
  if (children.length > 1) {
    if (steps.length === 0) {
      return {
        message: `NCIHAP\nSelect your child:\n${children.map((c, i) => `${i + 1}. ${firstNameOf(c.fullName)}`).join('\n')}`,
        continue: true
      };
    }
    const idx = Number(steps[0]) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= children.length) {
      return { message: 'Invalid selection. Please dial again.', continue: false };
    }
    child = children[idx];
    menuStep = steps[1];
  }

  const doses = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber,
    dueDate: d.dueDate, administeredDate: d.administeredDate ?? null
  }));
  const status = computeChildStatus(doses, { now, needsReconciliation: child.needsReconciliation });
  const first = firstNameOf(child.fullName);

  // Child main menu.
  if (!menuStep) {
    return {
      message: `${first}: ${statusHeadline(status)}\n1. Next vaccine\n2. Reward status\n0. Exit`,
      continue: true
    };
  }

  if (menuStep === '1') {
    const next = doses.filter((d) => !d.administeredDate).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    if (!next) {
      return { message: `${first} is fully immunised. Well done!`, continue: false };
    }
    const facility = await FacilityModel.findById(child.currentFacilityId);
    const days = Math.round((next.dueDate.getTime() - now.getTime()) / DAY);
    const when = days >= 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
    return {
      message: `Next for ${first}:\n${next.displayName}\nDue ${when}\nAt ${facility?.name ?? 'your health centre'}\nBring the card.`,
      continue: false
    };
  }

  if (menuStep === '2') {
    const milestones = computeMilestones(doses, child.dateOfBirth);
    const earned = milestones.filter((m) => m.attained).map((m) => m.title);
    const nx = nextMilestone(milestones);
    const earnedLine = earned.length ? `Earned: ${earned.join(', ')}.` : 'No rewards earned yet.';
    const nextLine = nx ? ` Next: ${nx.reward} (${nx.dosesToGo} to go).` : ' All rewards earned!';
    return { message: `${first}'s rewards:\n${earnedLine}${nextLine}`, continue: false };
  }

  if (menuStep === '0') {
    return { message: 'Thank you. Keep your child protected.', continue: false };
  }

  return { message: 'Invalid choice.', continue: false };
}
