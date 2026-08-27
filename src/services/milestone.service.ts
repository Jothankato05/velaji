import type { DoseInput } from './schedule.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The staged incentive model (NCIHAP §14): rather than rewarding only the very
 * last vaccine, the journey has three milestones so a family stays engaged the
 * whole way through. §12/§15 frame these as encouragement, never "payment for
 * vaccination" and never a punishment for falling behind.
 *
 *   M1 birth        — birth registration + initial immunisation → a digital badge
 *   M2 foundation   — the infant primary series checkpoint      → a wellness benefit
 *   M3 healthy_start— the full age-appropriate schedule         → NHIA coverage
 */
export type MilestoneKey = 'birth' | 'foundation' | 'healthy_start';

export interface MilestoneReward {
  key: MilestoneKey;
  title: string;
  reward: string;
  blurb: string;
  total: number;
  administered: number;
  attained: boolean;
  attainedAt: string | null;
}

interface MilestoneDef {
  key: MilestoneKey;
  title: string;
  reward: string;
  blurb: string;
  /** A dose belongs to this milestone when its scheduled age (days from birth)
   *  is below this bound. Infinity = the whole schedule. */
  maxAgeDays: number;
}

// Boundaries match the age bands the MyChild journey already groups doses by
// (birth < 21d, infant series < 200d), so the milestones line up with what a
// parent sees on the vaccine timeline.
const DEFS: MilestoneDef[] = [
  { key: 'birth', title: 'Birth Start', reward: 'Digital birth-immunisation certificate', blurb: 'Registered and off to a protected start.', maxAgeDays: 21 },
  { key: 'foundation', title: 'Foundation Protected', reward: 'Child wellness benefit', blurb: 'The infant series is complete — the hardest stretch, done.', maxAgeDays: 200 },
  { key: 'healthy_start', title: 'Healthy Start', reward: '12 months of NHIA child health coverage', blurb: 'Fully immunised — health protection unlocked.', maxAgeDays: Infinity }
];

export function computeMilestones(doses: DoseInput[], dateOfBirth: Date): MilestoneReward[] {
  return DEFS.map((def) => {
    const inSet = doses.filter((d) => (d.dueDate.getTime() - dateOfBirth.getTime()) / DAY < def.maxAgeDays);
    const administeredDates = inSet.map((d) => d.administeredDate).filter(Boolean) as Date[];
    const attained = inSet.length > 0 && administeredDates.length === inSet.length;
    const attainedAt = attained && administeredDates.length
      ? new Date(Math.max(...administeredDates.map((x) => x.getTime()))).toISOString()
      : null;
    return {
      key: def.key,
      title: def.title,
      reward: def.reward,
      blurb: def.blurb,
      total: inSet.length,
      administered: administeredDates.length,
      attained,
      attainedAt
    };
  });
}

/** The first milestone not yet reached, with how many doses remain — the "next
 *  reward" MyChild dangles to keep the family moving (§14 engagement). */
export function nextMilestone(milestones: MilestoneReward[]): { key: MilestoneKey; reward: string; dosesToGo: number } | null {
  const next = milestones.find((m) => !m.attained);
  if (!next) return null;
  return { key: next.key, reward: next.reward, dosesToGo: Math.max(0, next.total - next.administered) };
}
