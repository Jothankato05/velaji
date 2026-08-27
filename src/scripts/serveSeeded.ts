/**
 * Dev-only: boot the real API on PORT with a small, hand-picked seed so the
 * MyChild and Command Centre UIs can be driven in a browser against real data.
 * Seeds an admin login, several facilities across three states with distinct
 * green / amber / red coverage profiles (so the priority table and the
 * drill-down triage both have real data), and one MyChild card. Prints the
 * admin creds and the card link. Not used in production.
 */
import type { Types } from 'mongoose';
import { app } from '../app';
import { env } from '../config/env';
import { connectDatabase } from '../config/db';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { StaffUserModel } from '../models/StaffUser';
import { DoseAdministrationModel } from '../models/DoseAdministration';
import { generateChin } from '../services/chin.service';
import { buildDosesForChild } from '../services/schedule.service';
import { maybeIssueCertificate } from '../services/certificate.service';
import { signChin } from '../services/verification-token.service';
import { hashPassword } from '../utils/password';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
type Id = Types.ObjectId;
type Profile = 'complete' | 'ontrack' | 'overdue' | 'zero' | 'nearterm';

async function makeChild(facilityId: Id, caregiverId: Id, profile: Profile, name: string) {
  // 'nearterm' = a ~6-week-old, birth doses given, whose infant-series doses
  // fall due within the next weeks — real upcoming demand for the §18 plan.
  const ageMonths = profile === 'complete' ? 30 : profile === 'ontrack' ? 6 : profile === 'overdue' ? 13 : profile === 'nearterm' ? 1.3 : 1.5;
  const dob = new Date(now - ageMonths * 30.44 * DAY);
  const doses = buildDosesForChild(dob);
  for (const d of doses) {
    if (d.dueDate.getTime() >= now) continue;
    if (profile === 'complete' || profile === 'ontrack' || profile === 'nearterm') d.administeredDate = new Date(d.dueDate.getTime() + 2 * DAY);
    else if (profile === 'overdue' && Math.random() < 0.5) d.administeredDate = new Date(d.dueDate.getTime() + 2 * DAY);
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

async function seedFacility(state: string, lga: string, ward: string, facName: string, mix: Partial<Record<Profile, number>>) {
  const facility = await FacilityModel.create({ name: facName, wardName: ward, lgaName: lga, stateName: state, location: { lat: 9, lng: 7 } });
  const caregiver = await CaregiverModel.create({ fullName: `${ward} Caregiver`, phone: '+2348030000000' });
  const children: Awaited<ReturnType<typeof makeChild>>[] = [];
  for (const profile of Object.keys(mix) as Profile[]) {
    for (let i = 0; i < (mix[profile] ?? 0); i++) {
      children.push(await makeChild(facility._id, caregiver._id, profile, `${ward} Child ${i + 1}`));
    }
  }
  return children;
}

async function main() {
  await connectDatabase();

  await StaffUserModel.create({
    username: 'admin', passwordHash: await hashPassword('admin-demo-pass'), fullName: 'Command Admin', role: 'admin'
  });

  // FCT — healthy (green): two facilities, both strong. nearterm = upcoming demand.
  const fctChildren = [
    ...await seedFacility('FCT', 'AMAC', 'Wuse', 'Wuse PHC', { complete: 10, ontrack: 5, nearterm: 12 }),
    ...await seedFacility('FCT', 'Bwari', 'Kubwa', 'Kubwa PHC', { complete: 6, ontrack: 4, nearterm: 8 })
  ];

  // Lagos — watch (amber): one solid, one slipping.
  await seedFacility('Lagos', 'Ikeja', 'Alausa', 'Alausa PHC', { complete: 7, ontrack: 4, nearterm: 10 });
  await seedFacility('Lagos', 'Eti-Osa', 'Lekki', 'Lekki PHC', { complete: 3, ontrack: 2, overdue: 3, nearterm: 6 });

  // Kano — priority (red): the worst LGA (Dala) should surface first when drilling.
  await seedFacility('Kano', 'Dala', 'Gwammaja', 'Gwammaja PHC', { complete: 1, overdue: 9, zero: 3, nearterm: 7 });
  await seedFacility('Kano', 'Nassarawa', 'Tudun Wada', 'Tudun Wada PHC', { complete: 2, ontrack: 1, overdue: 5, nearterm: 5 });

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

  // One named MyChild card (in FCT), reusing an on-track child.
  const cardChild = fctChildren.find((c) => c.doses.some((d) => !d.administeredDate)) ?? fctChildren[0];
  await ChildModel.updateOne({ _id: cardChild._id }, { fullName: 'Zara Bello' });
  const token = signChin(cardChild.chin);

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SEEDED API on ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log('ADMIN_LOGIN=admin / admin-demo-pass');
    // eslint-disable-next-line no-console
    console.log(`CARD_LINK=${env.APP_BASE_URL}/mychild/${cardChild.chin}?t=${token}`);
  });
}

void main().catch((e) => { console.error(e); process.exit(1); });
