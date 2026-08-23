/**
 * Dev-only: boot the real API on PORT with a small, hand-picked seed so the
 * MyChild and Command Centre UIs can be driven in a browser against real data.
 * Prints a ready-to-use MyChild card link. Not used in production.
 */
import { app } from '../app';
import { env } from '../config/env';
import { connectDatabase } from '../config/db';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { generateChin } from '../services/chin.service';
import { buildDosesForChild } from '../services/schedule.service';
import { maybeIssueCertificate } from '../services/certificate.service';
import { signChin } from '../services/verification-token.service';

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  await connectDatabase();

  const facility = await FacilityModel.create({
    name: 'Wuse PHC', wardName: 'Wuse', lgaName: 'AMAC', stateName: 'FCT',
    location: { lat: 9.07, lng: 7.49 }
  });
  const caregiver = await CaregiverModel.create({ fullName: 'Aisha Bello', phone: '+2348030000000' });

  // A ~7-month-old, on track (partial doses) — shows header + journey nicely.
  const dob = new Date(Date.now() - 7 * 30.44 * DAY);
  const doses = buildDosesForChild(dob);
  const now = Date.now();
  for (const d of doses) {
    if (d.dueDate.getTime() < now - 20 * DAY) d.administeredDate = new Date(d.dueDate.getTime() + 2 * DAY);
  }
  const chin = generateChin(dob);
  const child = await ChildModel.create({
    chin, fullName: 'Zara Bello', sex: 'female', dateOfBirth: dob,
    caregiverId: caregiver._id, homeFacilityId: facility._id, currentFacilityId: facility._id, doses
  });
  await maybeIssueCertificate(child);

  const token = signChin(chin);
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SEEDED API on ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`CARD_CHIN=${chin}`);
    // eslint-disable-next-line no-console
    console.log(`CARD_TOKEN=${token}`);
    // eslint-disable-next-line no-console
    console.log(`CARD_LINK=${env.APP_BASE_URL}/mychild/${chin}?t=${token}`);
  });
}

void main().catch((e) => { console.error(e); process.exit(1); });
