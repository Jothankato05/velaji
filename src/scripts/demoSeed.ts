/**
 * The demo dataset, as a reusable seeder.
 *
 * Seeds an admin login, facilities across states with distinct green / amber /
 * red coverage profiles (so the priority table and drill-down triage both have
 * real data), one MyChild card, a USSD phone, wallet records, a fraud burst,
 * traced escalations with barriers, the antenatal register and civil
 * registration status.
 *
 * Used by `seed:serve` (local, in-memory) and — guarded by DEMO_SEED_ON_BOOT
 * and only when the database is empty — by the deployed demo instance, so a
 * public prototype URL shows a populated Command Centre rather than zeros.
 *
 * This is DEMO data: every child in it is invented. It must never run against
 * a database holding real records, which is why the caller checks emptiness.
 */
import type { Types } from 'mongoose';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { StaffUserModel } from '../models/StaffUser';
import { DoseAdministrationModel } from '../models/DoseAdministration';
import { HealthRecordModel } from '../models/HealthRecord';
import { FacilityHandoffModel } from '../models/FacilityHandoff';
import { EscalationModel } from '../models/Escalation';
import { PregnancyModel } from '../models/Pregnancy';
import { generateChin, generateAncId } from '../services/chin.service';
import { buildDosesForChild } from '../services/schedule.service';
import { maybeIssueCertificate } from '../services/certificate.service';
import { signChin } from '../services/verification-token.service';
import { hashPassword } from '../utils/password';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
type Id = Types.ObjectId;
type Profile = 'complete' | 'ontrack' | 'overdue' | 'zero' | 'nearterm';

// Deterministic pseudo-random numbers (mulberry32), so the demo comes out the
// same on every seed while still looking like a real, uneven population.
let rngState = 0x5eed;
function rand(): number {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

// Age range in days for each profile. Each child gets its own age inside the
// range, so doses (and the administration trend) spread over real weeks instead
// of every child in a profile sharing one birthday. Ranges are chosen so the
// profile still holds against the schedule (birth, 6/10/14 weeks, 9 and 15 months).
const AGE_DAYS: Record<Profile, [number, number]> = {
  nearterm: [8, 41], // birth doses given; 6-week doses fall due within ~5 weeks
  zero: [20, 100], // nothing given yet
  ontrack: [45, 260], // every dose due so far given; 9-month doses still ahead
  overdue: [300, 440], // past 9 months with gaps; 15-month dose not yet due
  complete: [460, 1000] // every scheduled dose given
};

async function makeChild(facilityId: Id, caregiverId: Id, profile: Profile, name: string) {
  const [lo, hi] = AGE_DAYS[profile];
  const dob = new Date(now - Math.round(between(lo, hi)) * DAY);
  const doses = buildDosesForChild(dob);
  // Given 0-9 days after falling due, never in the future.
  const given = (due: Date) => new Date(Math.min(due.getTime() + Math.round(between(0, 9)) * DAY, now - 60 * 60 * 1000));
  for (const d of doses) {
    if (d.dueDate.getTime() >= now) continue;
    if (profile === 'complete' || profile === 'ontrack' || profile === 'nearterm') d.administeredDate = given(d.dueDate);
    else if (profile === 'overdue' && rand() < 0.5) d.administeredDate = given(d.dueDate);
    // 'zero' → nothing administered
  }
  const chin = generateChin(dob);
  const child = await ChildModel.create({
    chin, fullName: name, sex: 'female', dateOfBirth: dob,
    caregiverId, homeFacilityId: facilityId, currentFacilityId: facilityId, doses
  });
  await maybeIssueCertificate(child);
  return child;
}

async function seedFacility(
  state: string, lga: string, ward: string, facName: string, mix: Partial<Record<Profile, number>>,
  infra: { cold?: 'functional' | 'at_risk' | 'down'; access?: 'accessible' | 'hard_to_reach' | 'security_compromised' } = {}
) {
  const facility = await FacilityModel.create({
    name: facName, wardName: ward, lgaName: lga, stateName: state, location: { lat: 9, lng: 7 },
    coldChainStatus: infra.cold ?? 'functional', accessibility: infra.access ?? 'accessible'
  });
  const caregiver = await CaregiverModel.create({ fullName: `${ward} Caregiver`, phone: '+2348030000000' });
  const children: Awaited<ReturnType<typeof makeChild>>[] = [];
  for (const profile of Object.keys(mix) as Profile[]) {
    for (let i = 0; i < (mix[profile] ?? 0); i++) {
      children.push(await makeChild(facility._id, caregiver._id, profile, `${ward} Child ${i + 1}`));
    }
  }
  return children;
}


export interface DemoSeedResult {
  cardChin: string;
  cardToken: string;
  ussdPhone: string;
}

export async function seedDemoData(): Promise<DemoSeedResult> {
  rngState = 0x5eed;

  await StaffUserModel.create({
    username: 'admin', passwordHash: await hashPassword('admin-demo-pass'), fullName: 'Command Admin', role: 'admin'
  });

  // The geographic picture mirrors the real Nigerian coverage map (WHO/UNICEF,
  // NPHCDA): the South and FCT do better; the north-west and north-east carry
  // the zero-dose / defaulter burden and low coverage (<40% in the worst NW
  // states), and Kano — the epicentre of the 2022–25 diphtheria outbreak — is
  // the priority state that should surface first.

  // South / FCT — higher coverage (green).
  const fctChildren = [
    ...await seedFacility('FCT', 'AMAC', 'Wuse', 'Wuse PHC', { complete: 10, ontrack: 5, nearterm: 12 }),
    ...await seedFacility('FCT', 'Bwari', 'Kubwa', 'Kubwa PHC', { complete: 6, ontrack: 4, nearterm: 8 })
  ];
  await seedFacility('Lagos', 'Ikeja', 'Alausa', 'Alausa PHC', { complete: 8, ontrack: 4, nearterm: 8 });
  await seedFacility('Enugu', 'Enugu North', 'Ogui', 'Ogui PHC', { complete: 11, ontrack: 4, nearterm: 6 });

  // North-west — the lowest-coverage states (Katsina/Sokoto/Zamfara < 40%; Kano
  // the outbreak epicentre) → priority (red).
  await seedFacility('Kano', 'Dala', 'Gwammaja', 'Gwammaja PHC', { complete: 1, overdue: 9, zero: 3, nearterm: 7 }, { cold: 'at_risk' });
  await seedFacility('Kano', 'Nassarawa', 'Tudun Wada', 'Tudun Wada PHC', { complete: 2, ontrack: 1, overdue: 5, nearterm: 5 });
  await seedFacility('Katsina', 'Katsina', 'Kofar Sauri', 'Kofar Sauri PHC', { complete: 1, overdue: 8, zero: 5, nearterm: 4 }, { cold: 'down' });
  await seedFacility('Sokoto', 'Sokoto North', 'Runjin Sambo', 'Runjin Sambo PHC', { complete: 1, overdue: 7, zero: 6, nearterm: 4 }, { cold: 'at_risk', access: 'hard_to_reach' });
  await seedFacility('Zamfara', 'Gusau', 'Sabon Gari', 'Sabon Gari PHC', { complete: 0, overdue: 9, zero: 5, nearterm: 3 }, { access: 'hard_to_reach' });

  // North-east — insecurity-affected, low coverage → priority (red); dedicated
  // outreach needed (Reaching Every Settlement model).
  await seedFacility('Borno', 'Maiduguri', 'Bolori', 'Bolori PHC', { complete: 2, overdue: 6, zero: 4, nearterm: 4 }, { cold: 'down', access: 'security_compromised' });

  // A suspicious recording burst so the §17 Integrity panel has a live example:
  // one worker "recording" ~30 doses within a few minutes (impossible throughput).
  const burst = [];
  for (let i = 0; i < 30; i++) {
    burst.push({
      chin: `NG-24-01-2000000${i % 10}`, childId: fctChildren[0]._id, vaccineCode: 'OPV', doseNumber: 1,
      facilityId: null, recordedBy: 'idris.k', recordedByRole: 'staff', duplicate: false,
      recordedAt: new Date(now - 40 * 60 * 1000 + i * 8 * 1000)
    });
  }
  await DoseAdministrationModel.insertMany(burst);

  // One named MyChild card (in FCT), reusing an on-track child. Give it a
  // dedicated caregiver with a distinct phone so the USSD demo maps that number
  // to exactly this one child.
  // The card's health records (7.4 kg, sitting and babbling) describe a baby of
  // about six months, so pick the FCT child closest to that age who still has a
  // vaccine ahead.
  const ageDays = (c: (typeof fctChildren)[number]) => (now - c.dateOfBirth.getTime()) / DAY;
  const cardChild =
    fctChildren
      .filter((c) => c.doses.some((d) => !d.administeredDate))
      .sort((a, b) => Math.abs(ageDays(a) - 185) - Math.abs(ageDays(b) - 185))[0] ?? fctChildren[0];
  const ussdPhone = '+2348010000001';
  const ussdCaregiver = await CaregiverModel.create({ fullName: 'Aisha Bello', phone: ussdPhone });
  await ChildModel.updateOne({ _id: cardChild._id }, { fullName: 'Zara Bello', caregiverId: ussdCaregiver._id });

  // A few Child Health Wallet records (§21) so the account shows growth beyond
  // vaccines.
  const rec = (domain: string, title: string, value: string, daysAgo: number) => ({
    chin: cardChild.chin, childId: cardChild._id, domain, title, value, note: '',
    facilityId: cardChild.currentFacilityId, recordedBy: 'nurse.amina', recordedByRole: 'staff',
    recordedAt: new Date(now - daysAgo * DAY)
  });
  await HealthRecordModel.insertMany([
    rec('growth', 'Weight-for-age', '7.4 kg · on track', 12),
    rec('vitamin_a', 'Vitamin A', 'First dose given', 12),
    rec('nutrition', 'Feeding', 'Exclusive breastfeeding', 40),
    rec('development', 'Milestones', 'Sitting, babbling, age-appropriate', 12)
  ]);

  // §19: a share of children are home births via non-PHC channels — inclusion.
  const sample = await ChildModel.find({}).limit(40);
  for (let i = 0; i < sample.length; i++) {
    if (i % 4 === 0) await ChildModel.updateOne({ _id: sample[i]._id }, { birthSetting: 'home', registrationChannel: i % 8 === 0 ? 'chw' : 'mobile_team' });
    else if (i % 5 === 0) await ChildModel.updateOne({ _id: sample[i]._id }, { registrationChannel: 'outreach' });
    else if (i % 7 === 0) await ChildModel.updateOne({ _id: sample[i]._id }, { registrationChannel: 'hospital' });
  }

  // §20: a few relocations, most cross-state — continuity survives the move.
  const facs = await FacilityModel.find({});
  const dests = ['Kano', 'FCT', 'Lagos']
    .map((s) => facs.find((f) => f.stateName === s))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  const movers = await ChildModel.find({}).limit(7);
  const reasons = ['relocation', 'displacement', 'nomadic', 'migration', 'relocation', 'displacement', 'nomadic'] as const;
  for (let i = 0; i < movers.length; i++) {
    const to = dests[i % dests.length];
    if (String(to._id) === String(movers[i].currentFacilityId)) continue;
    await FacilityHandoffModel.create({
      childId: movers[i]._id, fromFacilityId: movers[i].currentFacilityId, toFacilityId: to._id,
      reportedLocation: { lat: 9, lng: 7 }, reason: '', reasonCategory: reasons[i], handoffAt: new Date(now - (i + 1) * 3 * DAY)
    });
    await ChildModel.updateOne({ _id: movers[i]._id }, { currentFacilityId: to._id });
  }

  // A few traced-and-resolved cases with the barrier recorded, so the "Why
  // children default" view has data. The mix mirrors the documented drivers —
  // hesitancy leads, then access/awareness, with insecurity in the north-east.
  const traced = await ChildModel.find({}).limit(14);
  const barrierMix = ['hesitancy', 'hesitancy', 'hesitancy', 'hesitancy', 'distance', 'distance', 'distance', 'unaware', 'unaware', 'insecurity', 'insecurity', 'financial', 'no_session', 'other'] as const;
  for (let i = 0; i < traced.length; i++) {
    const c = traced[i];
    await EscalationModel.create({
      childId: c._id, chin: c.chin, doseKey: `PENTA#1`, reason: i % 2 === 0 ? 'lost_to_followup' : 'max_attempts',
      remindersSent: 3, status: 'resolved', raisedAt: new Date(now - (i + 5) * DAY), lastSeenAt: new Date(now - (i + 5) * DAY),
      resolvedAt: new Date(now - (i + 1) * DAY), resolvedBy: 'nurse.amina', outcome: i % 3 === 0 ? 'immunized' : 'reached',
      barrier: barrierMix[i]
    });
  }

  // §19 extended: the antenatal register — children not yet born. The contact
  // mix is deliberately skewed to mirror reality: NDHS 2023-24 puts ANC at 63%
  // but only 52% reaching four visits, and WHO's recommended eight contacts sits
  // near 13% across LMICs. So most active pregnancies here sit below four.
  const ancFacilities = await FacilityModel.find({}).limit(8);
  const ancCarers = await CaregiverModel.find({}).limit(10);
  if (ancFacilities.length && ancCarers.length) {
    // visitCounts below 4 are the at-risk band; a few reach 4-7 and one reaches 8.
    const visitCounts = [0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8, 2, 1, 0, 3, 2];
    for (let i = 0; i < visitCounts.length; i++) {
      const fac = ancFacilities[i % ancFacilities.length];
      const carer = ancCarers[i % ancCarers.length];
      // Spread due dates: mostly ahead, a few already past so the follow-up
      // list has the "birth never reported" cases that matter most.
      const offsetDays = i < 3 ? -(20 + i * 8) : (i - 2) * 9;
      const visits = [];
      for (let v = 0; v < visitCounts[i]; v++) {
        visits.push({ visitNumber: v + 1, date: new Date(now - (visitCounts[i] - v) * 21 * DAY), facilityId: fac._id });
      }
      await PregnancyModel.create({
        ancId: generateAncId(),
        caregiverId: carer._id,
        facilityId: fac._id,
        expectedDeliveryDate: new Date(now + offsetDays * DAY),
        visits,
        status: 'active'
      });
    }
    // A handful that already converted to child records, so the funnel shows a
    // real conversion rate rather than 0%.
    const linkedChildren = await ChildModel.find({ registrationChannel: 'phc' }).limit(5);
    for (let i = 0; i < linkedChildren.length; i++) {
      const c = linkedChildren[i];
      await ChildModel.updateOne({ _id: c._id }, { registrationChannel: 'antenatal' });
      await PregnancyModel.create({
        ancId: generateAncId(),
        caregiverId: c.caregiverId,
        facilityId: c.homeFacilityId,
        expectedDeliveryDate: new Date(c.dateOfBirth.getTime() - 4 * DAY),
        visits: [1, 2, 3, 4].map((v) => ({ visitNumber: v, date: new Date(c.dateOfBirth.getTime() - (5 - v) * 28 * DAY), facilityId: c.homeFacilityId })),
        status: 'linked', linkedChildId: c._id, linkedChin: c.chin, linkedAt: c.dateOfBirth
      });
    }
  }

  // §4 civil registration. Deliberately skewed to the real distribution: only
  // ~57% of Nigerian under-five births are registered, and the gap concentrates
  // in the same states as low immunisation coverage. Children registered through
  // home births and CHW/mobile channels are the least likely to be registered,
  // which is exactly the population BHCPF cannot enrol.
  const idChildren = await ChildModel.find({});
  for (let i = 0; i < idChildren.length; i++) {
    const c = idChildren[i];
    const homeBirth = c.birthSetting === 'home';
    // Facility births register far more often than home births.
    const registered = homeBirth ? i % 5 === 0 : i % 10 < 7;
    const referred = !registered && i % 3 === 0;
    if (registered) {
      await ChildModel.updateOne({ _id: c._id }, {
        'birthRegistration.status': 'registered',
        'birthRegistration.registrationNumber': `BRN-2026-${String(100000 + i).slice(-6)}`,
        'birthRegistration.nin': i % 2 === 0 ? String(70000000000 + i) : '',
        'birthRegistration.registeredAt': new Date(now - (i + 3) * DAY)
      });
    } else if (referred) {
      await ChildModel.updateOne({ _id: c._id }, {
        'birthRegistration.status': 'referred',
        'birthRegistration.referredAt': new Date(now - (i + 1) * DAY)
      });
    }
  }

  const token = signChin(cardChild.chin);
  return { cardChin: cardChild.chin, cardToken: token, ussdPhone };
}
