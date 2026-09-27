import { ChildModel, type ChildDoc } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { normalizeChin } from './chin.service';
import { AppError } from '../utils/AppError';

/**
 * Civil registration referral (NCIHAP §4).
 *
 * Velaji does not register births — the National Population Commission does.
 * What Velaji has that NPC does not is the CONTACT: it knows the child exists,
 * has a caregiver and a phone, and is standing in a facility. NPC's own
 * direction of travel is to meet that contact (digital birth registration now
 * runs in 6,000+ of 8,809 wards, with NIMC linking registrations to the national
 * identity database through the mother's identity, and "Renewed Hope" targeting
 * a NIN at the point of registration).
 *
 * So this is a referral seam, not an integration: mark that a child has been
 * handed to NPC, then carry the birth registration number and NIN back onto the
 * health record when they are issued. Honest about what it is — the actual NPC
 * API call is where a real deployment plugs in.
 *
 * Why it matters more than a status field looks: BHCPF's Vulnerable Group Fund
 * covers under-fives but enrols via the social register and the NIN, so an
 * unregistered child cannot claim the coverage that completing the immunisation
 * schedule is supposed to unlock. Without this, the incentive is unreachable for
 * exactly the children who need it most.
 */

const UNKNOWN = '(unknown)';

export type BirthRegistrationStatus = 'not_registered' | 'referred' | 'registered';

export interface BirthRegistrationView {
  chin: string;
  status: BirthRegistrationStatus;
  registrationNumber: string;
  nin: string;
  referredAt: Date | null;
  registeredAt: Date | null;
}

function toView(child: Pick<ChildDoc, 'chin' | 'birthRegistration'>): BirthRegistrationView {
  const br = child.birthRegistration;
  return {
    chin: child.chin,
    status: (br?.status ?? 'not_registered') as BirthRegistrationStatus,
    registrationNumber: br?.registrationNumber ?? '',
    nin: br?.nin ?? '',
    referredAt: br?.referredAt ?? null,
    registeredAt: br?.registeredAt ?? null
  };
}

async function findChild(chin: string) {
  const child = await ChildModel.findOne({ chin: normalizeChin(chin) });
  if (!child) throw new AppError(`No child found with CHIN ${normalizeChin(chin)}`, 404);
  return child;
}

/** Hand this child to NPC for birth registration. */
export async function referForRegistration(chin: string, now: Date = new Date()): Promise<BirthRegistrationView> {
  const child = await findChild(chin);
  if (child.birthRegistration?.status === 'registered') {
    throw new AppError('This child is already registered with a birth registration number', 409);
  }
  child.set('birthRegistration.status', 'referred');
  child.set('birthRegistration.referredAt', now);
  await child.save();
  return toView(child);
}

/**
 * NPC issued the birth registration. Carry the numbers onto the health record —
 * the registration number always, and the NIN once NIMC has issued one.
 */
export async function recordRegistration(
  chin: string,
  input: { registrationNumber: string; nin?: string },
  now: Date = new Date()
): Promise<BirthRegistrationView> {
  const child = await findChild(chin);
  const number = String(input.registrationNumber ?? '').trim();
  if (!number) throw new AppError('registrationNumber is required');

  child.set('birthRegistration.status', 'registered');
  child.set('birthRegistration.registrationNumber', number);
  child.set('birthRegistration.registeredAt', now);
  if (input.nin) child.set('birthRegistration.nin', String(input.nin).trim());
  await child.save();
  return toView(child);
}

export interface IdentityGap {
  /** Children Velaji knows exist. */
  known: number;
  registered: number;
  referred: number;
  /** Known to health, invisible to civil registration — and so unenrollable. */
  unregistered: number;
  withNin: number;
  /** Worst-first: where the health system is meeting children the state cannot see. */
  byState: Array<{ state: string; known: number; unregistered: number; rate: number }>;
}

/**
 * The identity gap: children with a health record but no legal identity.
 *
 * This is the number that makes the case — every one of these is a child the
 * health system has already reached and can name, who still cannot be enrolled
 * in the fund that exists for her. Aggregate counts only (§24).
 */
export async function identityGap(): Promise<IdentityGap> {
  const [children, facilities] = await Promise.all([ChildModel.find({}), FacilityModel.find({})]);
  const stateById = new Map(facilities.map((f) => [String(f._id), f.stateName || UNKNOWN]));

  let registered = 0;
  let referred = 0;
  let withNin = 0;
  const byState = new Map<string, { known: number; unregistered: number }>();

  for (const c of children) {
    const status = (c.birthRegistration?.status ?? 'not_registered') as BirthRegistrationStatus;
    if (status === 'registered') registered += 1;
    else if (status === 'referred') referred += 1;
    if (c.birthRegistration?.nin) withNin += 1;

    const state = stateById.get(String(c.currentFacilityId)) ?? UNKNOWN;
    let row = byState.get(state);
    if (!row) {
      row = { known: 0, unregistered: 0 };
      byState.set(state, row);
    }
    row.known += 1;
    if (status !== 'registered') row.unregistered += 1;
  }

  return {
    known: children.length,
    registered,
    referred,
    unregistered: children.length - registered,
    withNin,
    byState: [...byState.entries()]
      .map(([state, v]) => ({
        state,
        known: v.known,
        unregistered: v.unregistered,
        rate: v.known ? Math.round((v.unregistered / v.known) * 1000) / 1000 : 0
      }))
      .sort((a, b) => b.unregistered - a.unregistered)
  };
}
