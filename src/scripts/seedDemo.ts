/**
 * Seed a realistic NCIHAP demo dataset so the Command Centre and MyChild
 * apps show a living national picture — like the reference mockups — rather
 * than an empty/alarming one. Pilot states are those named in the note (§25).
 *
 * Usage:  MONGODB_URI=... npx tsx src/scripts/seedDemo.ts
 * WARNING: clears children, facilities, caregivers, certificates first.
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { CertificateModel } from '../models/Certificate';
import { EscalationModel } from '../models/Escalation';
import { generateChin } from '../services/chin.service';
import { buildDosesForChild } from '../services/schedule.service';
import { maybeIssueCertificate } from '../services/certificate.service';

const DAY = 24 * 60 * 60 * 1000;

const GEO: Array<[string, Array<[string, string[]]>]> = [
  ['FCT', [['AMAC', ['Wuse', 'Garki', 'Karu']], ['Bwari', ['Kubwa', 'Dutse']]]],
  ['Lagos', [['Ikeja', ['Oregun', 'Alausa']], ['Eti-Osa', ['Lekki', 'Ajah']]]],
  ['Kano', [['Dala', ['Gwammaja']], ['Nassarawa', ['Tudun Wada', 'Hotoro']]]],
  ['Nasarawa', [['Lafia', ['Bukan Sarki']], ['Karu', ['Mararaba']]]],
  ['Borno', [['Maiduguri', ['Bolori', 'Gwange']]]]
];
const FEMALE = ['Aisha', 'Zara', 'Fatima', 'Amina', 'Ngozi', 'Chioma', 'Halima', 'Blessing', 'Grace', 'Maryam'];
const MALE = ['Musa', 'Tunde', 'Chidi', 'Ibrahim', 'Emeka', 'Sani', 'David', 'Yusuf', 'Kunle', 'Abubakar'];
const SURNAME = ['Bello', 'Okoye', 'Adeyemi', 'Ibrahim', 'Eze', 'Yusuf', 'Okafor', 'Sani', 'Balogun', 'Mohammed'];

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const rand = (min: number, max: number) => min + Math.random() * (max - min);

async function main() {
  await connectDatabase();
  await Promise.all([
    ChildModel.deleteMany({}),
    FacilityModel.deleteMany({}),
    CaregiverModel.deleteMany({}),
    CertificateModel.deleteMany({}),
    EscalationModel.deleteMany({})
  ]);

  const now = Date.now();
  const facilities = [];
  for (const [state, lgas] of GEO) {
    for (const [lga, wards] of lgas) {
      for (const ward of wards) {
        facilities.push(
          await FacilityModel.create({
            name: `${ward} PHC`,
            wardName: ward,
            lgaName: lga,
            stateName: state,
            location: { lat: 9 + rand(-3, 3), lng: 7 + rand(-3, 3) }
          })
        );
      }
    }
  }

  let total = 0;
  let completed = 0;
  for (const f of facilities) {
    const count = Math.floor(rand(14, 30));
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      let ageMonths: number;
      let profile: 'complete' | 'ontrack' | 'overdue' | 'zero';
      if (r < 0.42) { ageMonths = rand(16, 44); profile = 'complete'; }
      else if (r < 0.72) { ageMonths = rand(1, 14); profile = 'ontrack'; }
      else if (r < 0.9) { ageMonths = rand(9, 14); profile = 'overdue'; }
      else { ageMonths = rand(0.2, 3); profile = 'zero'; }

      const female = Math.random() < 0.5;
      const dob = new Date(now - ageMonths * 30.44 * DAY);
      const doses = buildDosesForChild(dob);
      for (const d of doses) {
        const due = d.dueDate.getTime();
        if (due >= now) continue;
        if (profile === 'complete') d.administeredDate = new Date(due + rand(0, 12) * DAY);
        else if (profile === 'ontrack') d.administeredDate = new Date(due + rand(0, 6) * DAY);
        else if (profile === 'overdue' && Math.random() < 0.6) d.administeredDate = new Date(due + rand(0, 6) * DAY);
      }
      const allDone = doses.length > 0 && doses.every((d) => d.administeredDate);

      const cg = await CaregiverModel.create({
        fullName: `${pick(female ? FEMALE : MALE)} ${pick(SURNAME)}`,
        phone: `+23480${Math.floor(rand(10000000, 99999999))}`
      });
      const child = await ChildModel.create({
        chin: generateChin(dob),
        fullName: `${pick(female ? FEMALE : MALE)} ${pick(SURNAME)}`,
        sex: female ? 'female' : 'male',
        dateOfBirth: dob,
        caregiverId: cg._id,
        homeFacilityId: f._id,
        currentFacilityId: f._id,
        doses,
        completedAt: allDone ? new Date(now - rand(1, 60) * DAY) : null
      });
      await maybeIssueCertificate(child);
      if (allDone) completed += 1;
      total += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${total} children across ${facilities.length} facilities · ${completed} completed (Healthy Start).`);
  await disconnectDatabase();
}

void main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
