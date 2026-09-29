import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { computeChildStatus } from './schedule.service';
import { computeMilestones, nextMilestone } from './milestone.service';
import { phoneMatchSource } from '../utils/phone';
import { asParentDoses, parentSchedule } from './dose-rules.service';

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

/** Keys 1-9 on the handset, so at most nine children can be offered. */
const MAX_LISTED = 9;

export async function handleUssd(input: { phoneNumber: string; text: string }, now: Date = new Date()): Promise<UssdResult> {
  const steps = input.text ? input.text.split('*').map((s) => s.trim()) : [];

  // The network sends +234…; the caregiver's number was stored as typed at
  // registration (often 0803…, with spaces), so match on the last ten digits.
  const phoneRegex = phoneMatchSource(input.phoneNumber ?? '');
  const caregivers = phoneRegex ? await CaregiverModel.find({ phone: { $regex: phoneRegex } }) : [];
  const children = caregivers.length
    ? await ChildModel.find({ caregiverId: { $in: caregivers.map((c) => c._id) } }).sort({ dateOfBirth: -1 }).limit(MAX_LISTED)
    : [];

  if (children.length === 0) {
    return { message: 'No child is registered to this phone number.\nVisit your nearest health centre to register.', continue: false };
  }

  // The gateway re-sends every key pressed so far, so walk them in order. A
  // wrong key shows the same menu again rather than ending the call.
  let pos = 0;
  let child = children.length === 1 ? children[0] : null;
  if (!child) {
    let invalid = false;
    for (; pos < steps.length && !child; pos++) {
      const idx = Number(steps[pos]) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < children.length) child = children[idx];
      else invalid = true;
    }
    if (!child) {
      return {
        message: `${invalid ? 'Invalid choice.\n' : ''}Velaji\nSelect your child:\n${children.map((c, i) => `${i + 1}. ${firstNameOf(c.fullName)}`).join('\n')}`,
        continue: true
      };
    }
  }
  const menuSteps = steps.slice(pos);
  const menuStep = menuSteps.find((s) => s === '1' || s === '2' || s === '0');
  const hadInvalid = menuSteps.length > 0 && !menuStep;

  const doses = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode, displayName: d.displayName, doseNumber: d.doseNumber,
    dueDate: d.dueDate, administeredDate: d.administeredDate ?? null
  }));
  // What the family can act on: a series dose waits four weeks after the one before.
  const status = computeChildStatus(asParentDoses(doses), { now, needsReconciliation: child.needsReconciliation });
  const first = firstNameOf(child.fullName);

  // Child main menu.
  if (!menuStep) {
    return {
      message: `${hadInvalid ? 'Invalid choice.\n' : ''}${first}: ${statusHeadline(status)}\n1. Next vaccine\n2. Reward status\n0. Exit`,
      continue: true
    };
  }

  if (menuStep === '1') {
    const next = parentSchedule(doses)
      .filter((d) => !d.administeredDate && !d.waitingOnEarlier)
      .map((d) => ({ ...d, dueDate: d.comeDate }))
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    if (!next) {
      return { message: `${first} is fully immunised. Well done!`, continue: false };
    }
    const facility = await FacilityModel.findById(child.currentFacilityId);
    const days = Math.round((next.dueDate.getTime() - now.getTime()) / DAY);
    const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
    const when = days > 0 ? `Due in ${plural(days)}` : days === 0 ? 'Due today' : `Overdue by ${plural(-days)}. Please go soon.`;
    return {
      message: `Next for ${first}:\n${next.displayName}\n${when}\nAt ${facility?.name ?? 'your health centre'}\nBring the card.`,
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

  return { message: 'Thank you. Keep your child protected.', continue: false };
}
