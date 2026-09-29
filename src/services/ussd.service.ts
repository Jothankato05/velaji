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

/**
 * Networks cut a USSD screen off at 182 characters (the GSM limit), so a
 * longer reply loses its end, often the part that matters. Every reply is
 * checked; callers offer a shorter wording where one might run long.
 */
export const USSD_MAX_CHARS = 182;

/** The first of several wordings that fits on one USSD screen. */
function fit(...options: string[]): string {
  return options.find((o) => o.length + 4 <= USSD_MAX_CHARS) ?? options[options.length - 1].slice(0, USSD_MAX_CHARS - 4);
}

/** A first name short enough for a numbered menu on a small screen. */
function menuName(fullName: string): string {
  const f = firstNameOf(fullName);
  return f.length > 12 ? `${f.slice(0, 11)}.` : f;
}

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
        message: fit(
          `${invalid ? 'Invalid choice.\n' : ''}Velaji\nSelect your child:\n${children.map((c, i) => `${i + 1}. ${menuName(c.fullName)}`).join('\n')}`,
          `${invalid ? 'Invalid choice.\n' : ''}Select child:\n${children.map((c, i) => `${i + 1}.${menuName(c.fullName)}`).join('\n')}`
        ),
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
    const place = facility?.name ?? 'your health centre';
    return {
      message: fit(
        `Next for ${first}:\n${next.displayName}\n${when}\nAt ${place}\nBring the card.`,
        `Next for ${first}:\n${next.displayName}\n${when}\nAt ${place}`
      ),
      continue: false
    };
  }

  if (menuStep === '2') {
    const milestones = computeMilestones(doses, child.dateOfBirth);
    const earned = milestones.filter((m) => m.attained).map((m) => m.title);
    const nx = nextMilestone(milestones);
    const more = (n: number) => `${n} more vaccine${n === 1 ? '' : 's'}`;
    const earnedLine = earned.length ? `Earned: ${earned.join(', ')}.` : 'No rewards earned yet.';
    const earnedShort = earned.length ? `Earned ${earned.length} of ${milestones.length} rewards.` : 'No rewards earned yet.';
    const nextLine = nx ? `\nNext: ${nx.reward}, after ${more(nx.dosesToGo)}.` : '\nAll rewards earned!';
    const nextShort = nx ? `\nNext reward after ${more(nx.dosesToGo)}.` : '\nAll rewards earned!';
    return {
      message: fit(
        `${first}'s rewards:\n${earnedLine}${nextLine}`,
        `${first}'s rewards:\n${earnedShort}${nextLine}`,
        `${first}'s rewards:\n${earnedShort}${nextShort}`
      ),
      continue: false
    };
  }

  return { message: 'Thank you. Keep your child protected.', continue: false };
}
