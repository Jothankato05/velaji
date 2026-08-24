/**
 * Dev-only: boot the real API on PORT with a small, hand-picked seed so the
 * MyChild and Command Centre UIs can be driven in a browser against real data.
 * Seeds an admin login, three states with distinct green / amber / red coverage
 * profiles, and one MyChild card. Prints the admin creds and the card link.
 * Not used in production.
 */
import { app } from '../app';
import { env } from '../config/env';
import { connectDatabase } from '../config/db';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { StaffUserModel } from '../models/StaffUser';
import { generateChin } from '../services/chin.service';
import { buildDosesForChild } from '../services/schedule.service';
import { maybeIssueCertificate } from '../services/certificate.service';
import { signChin } from '../services/verification-token.service';
import { hashPassword } from '../utils/password';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
type Profile = 'complete' | 'ontrack' | 'overdue' | 'zero';

async function makeChild(facilityId: unknown, caregiverId: unknown, profile: Profile, name: string) {
  const ageMonths = profile === 'complete' ? 30 : profile === 'ontrack' ? 6 : profile === 'overdue' ? 13 : 1.5;
  const dob = new Date(now - ageMonths * 30.44 * DAY);
  const doses = buildDosesForChild(dob);
  for (const d of doses) {
    if (d.dueDate.getTime() >= now) continue;
    if (profile === 'complete' || profile === 'ontrack') d.administeredDate = new Date(d.dueDate.getTime() + 2 * DAY);
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

async function seedState(state: string, lga: string, ward: string, facName: string, mix: Record<Profile, number>) {
  const facility = await FacilityModel.create({ name: facName, wardName: ward, lgaName: lga, stateName: state, location: { lat: 9, lng: 7 } });
  const caregiver = await CaregiverModel.create({ fullName: `${ward} Caregiver`, phone: '+2348030000000' });
  const created: any[] = [];
  for (const profile of Object.keys(mix) as Profile[]) {
    for (let i = 0; i < mix[profile]; i++) {
      created.push(await makeChild(facility._id, caregiver._id, profile, `${ward} Child ${i + 1}`));
    }
  }
  return { facility, caregiver, children: created };
}

async function main() {
  await connectDatabase();

  await StaffUserModel.create({
    username: 'admin', passwordHash: await hashPassword('admin-demo-pass'), fullName: 'Command Admin', role: 'admin'
  });

  // Three states with deliberately different coverage health.
  const fct = await seedState('FCT', 'AMAC', 'Wuse', 'Wuse PHC', { complete: 14, ontrack: 6, overdue: 0, zero: 0 }); // green
  await seedState('Lagos', 'Ikeja', 'Alausa', 'Alausa PHC', { complete: 7, ontrack: 5, overdue: 2, zero: 0 }); // amber
  await seedState('Kano', 'Dala', 'Gwammaja', 'Gwammaja PHC', { complete: 2, ontrack: 0, overdue: 8, zero: 3 }); // red

  // One named MyChild card (in FCT), reusing an on-track child.
  const cardChild = fct.children.find((c) => c.doses.some((d: any) => !d.administeredDate)) ?? fct.children[0];
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
