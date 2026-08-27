import type { Request, Response } from 'express';
import { ChildModel } from '../models/Child';
import { FacilityModel } from '../models/Facility';
import { CaregiverModel } from '../models/Caregiver';
import { CertificateModel } from '../models/Certificate';
import { normalizeChin } from '../services/chin.service';
import { computeChildStatus, computeDoseStatus } from '../services/schedule.service';
import { computeMilestones, nextMilestone } from '../services/milestone.service';
import { getHealthRecords } from '../services/wallet.service';
import { verifyChinToken } from '../services/verification-token.service';
import { AppError } from '../utils/AppError';

const DAY = 24 * 60 * 60 * 1000;

const TIPS = [
  'Give your child safe, clean water often — especially in warm weather.',
  'Keep the vaccination card safe. It works at any health facility in Nigeria.',
  'Breastfeeding in the first months protects your baby from many illnesses.',
  'A little fever after a vaccine is normal. Offer fluids and comfort.',
  'Wash hands with soap before feeding your child.'
];

function ageLabel(dob: Date, now: Date): string {
  const months = Math.floor((now.getTime() - dob.getTime()) / (30.44 * DAY));
  if (months < 1) return 'newborn';
  if (months < 24) return `${months} months old`;
  return `${Math.floor(months / 12)} years old`;
}

// Group the schedule into the age bands a parent recognises.
function bandFor(ageDays: number): { key: string; name: string; order: number } {
  if (ageDays < 21) return { key: 'birth', name: 'Birth vaccines', order: 0 };
  if (ageDays < 200) return { key: 'infant', name: '6–14 week vaccines', order: 1 };
  if (ageDays < 380) return { key: 'ninemonth', name: '9-month vaccines', order: 2 };
  return { key: 'toddler', name: '15-month vaccines', order: 3 };
}

/**
 * The family (MyChild) view of a child, reached with the card — the parent's
 * key. Warm, milestone-grouped, and no clinical minutiae: what's done, what's
 * next, and the reward at the end. Card token gates access (NCIHAP §24).
 */
export async function familyJourney(req: Request, res: Response) {
  const raw = String(req.query.chin ?? req.params.chin ?? '');
  const token = String(req.query.t ?? '');
  const chin = normalizeChin(raw);

  if (!token || !verifyChinToken(chin, token)) {
    throw new AppError('That card could not be verified. Check the QR or Health ID.', 401);
  }

  const child = await ChildModel.findOne({ chin });
  if (!child) throw new AppError('No child found for that card.', 404);

  const now = new Date();
  const dob = child.dateOfBirth;

  const doses = child.doses.map((d) => ({
    vaccineCode: d.vaccineCode,
    displayName: d.displayName,
    doseNumber: d.doseNumber,
    dueDate: d.dueDate,
    administeredDate: d.administeredDate ?? null
  }));

  // Milestone groups
  const groups = new Map<string, { name: string; order: number; doses: typeof doses }>();
  for (const d of doses) {
    const ageDays = (d.dueDate.getTime() - dob.getTime()) / DAY;
    const b = bandFor(ageDays);
    if (!groups.has(b.key)) groups.set(b.key, { name: b.name, order: b.order, doses: [] });
    groups.get(b.key)!.doses.push(d);
  }
  const milestones = [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => {
      const done = g.doses.every((d) => d.administeredDate);
      const completedDates = g.doses.map((d) => d.administeredDate).filter(Boolean) as Date[];
      const completedAt = done && completedDates.length ? new Date(Math.max(...completedDates.map((x) => x.getTime()))) : null;
      return {
        name: g.name,
        total: g.doses.length,
        administered: g.doses.filter((d) => d.administeredDate).length,
        done,
        completedAt,
        vaccines: g.doses.map((d) => d.displayName)
      };
    });

  // A flat, per-dose list for the "My vaccines" view — every dose, in date
  // order, with a plain-language state a parent understands.
  const doseList = [...doses]
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((d) => {
      const band = bandFor((d.dueDate.getTime() - dob.getTime()) / DAY);
      const state = d.administeredDate
        ? 'done'
        : (computeDoseStatus(d.dueDate, now).toLowerCase() as 'green' | 'amber' | 'red');
      return {
        vaccine: d.displayName,
        doseNumber: d.doseNumber,
        band: band.name,
        state,
        administeredDate: d.administeredDate,
        dueDate: d.dueDate
      };
    });

  const administered = doses.filter((d) => d.administeredDate).length;
  const pending = doses.filter((d) => !d.administeredDate).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const next = pending[0] ?? null;
  const facility = await FacilityModel.findById(child.currentFacilityId);
  const caregiver = await CaregiverModel.findById(child.caregiverId);
  const certificate = await CertificateModel.findOne({ childId: child._id });
  const status = computeChildStatus(doses, { needsReconciliation: child.needsReconciliation });

  // The upcoming reminder groups everything due around the same date.
  const soonDate = next ? next.dueDate.getTime() : 0;
  const dueTogether = next ? pending.filter((d) => Math.abs(d.dueDate.getTime() - soonDate) < 3 * DAY) : [];

  res.json({
    chin: child.chin,
    firstName: child.fullName.split(' ')[0],
    fullName: child.fullName,
    parentName: caregiver?.fullName ?? null,
    age: ageLabel(dob, now),
    status,
    reassurance:
      status === 'BLUE'
        ? 'is fully protected. You did a wonderful job.'
        : status === 'GREEN'
          ? 'is protected and on track. You’re doing a wonderful job.'
          : status === 'AMBER'
            ? 'has a vaccine coming up. A quick visit keeps them protected.'
            : status === 'RED'
              ? 'has missed a vaccine. Please visit the health centre soon.'
              : 'has a record to reconcile. A health worker will help.',
    progress: { administered, total: doses.length, pct: doses.length ? Math.round((administered / doses.length) * 100) : 0 },
    milestones,
    doses: doseList,
    facility: facility
      ? { name: facility.name, ward: facility.wardName, lga: facility.lgaName, state: facility.stateName }
      : null,
    nextAppointment: next
      ? {
          vaccines: dueTogether.map((d) => d.displayName),
          date: next.dueDate,
          dueInDays: Math.round((next.dueDate.getTime() - now.getTime()) / DAY),
          facility: facility?.name ?? 'your health centre'
        }
      : null,
    coverage: certificate
      ? {
          programme: certificate.coverageProgramme,
          months: certificate.coverageMonths,
          expiresAt: certificate.coverageExpiresAt,
          active: (certificate.coverageExpiresAt?.getTime() ?? 0) > now.getTime()
        }
      : null,
    rewards: computeMilestones(doses, dob),
    nextReward: nextMilestone(computeMilestones(doses, dob)),
    healthRecords: await getHealthRecords(chin),
    tip: TIPS[now.getDate() % TIPS.length]
  });
}
