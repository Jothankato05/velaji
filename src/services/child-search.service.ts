import type { Types } from 'mongoose';
import { ChildModel } from '../models/Child';
import { CaregiverModel } from '../models/Caregiver';
import { FacilityModel } from '../models/Facility';
import { computeChildStatus } from './schedule.service';

/**
 * Find a child the way a health worker would at the desk when the card is
 * missing: by part of the CHIN, the child's or caregiver's name, or the
 * caregiver's phone number. Case- and spacing-insensitive; at most `limit`
 * results, exact CHIN first.
 */
export interface ChildSearchResult {
  chin: string;
  fullName: string;
  dateOfBirth: Date;
  status: string;
  facility: string | null;
  caregiverName: string | null;
  caregiverPhone: string | null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every word must appear somewhere in the name, in any order. */
function wordsMatch(words: string[]) {
  return words.map((w) => ({ $regex: escapeRegex(w), $options: 'i' }));
}

export async function searchChildren(raw: string, limit = 8): Promise<{ results: ChildSearchResult[]; more: boolean }> {
  const q = raw.trim().replace(/\s+/g, ' ');
  if (q.length < 2) return { results: [], more: false };

  const words = q.split(' ');
  // A full number may be typed 0803… or +234803…; match on what follows the prefix.
  const allDigits = q.replace(/\D/g, '');
  const digits = allDigits.length >= 10 ? allDigits.replace(/^(234|0)/, '') : allDigits;
  const or: Record<string, unknown>[] = [];

  // Part of a CHIN: "NG-25-07-4366", "43668961", "ng 25 07".
  const chinPart = q.toUpperCase().replace(/\s+/g, '');
  if (/\d/.test(chinPart)) or.push({ chin: { $regex: escapeRegex(chinPart) } });

  // The child's name.
  if (/[a-z]/i.test(q)) or.push({ $and: wordsMatch(words).map((m) => ({ fullName: m })) });

  // The caregiver: by name, or by seven or more digits of their phone
  // (stored however it was typed, so allow anything between the digits).
  const caregiverOr: Record<string, unknown>[] = [];
  if (/[a-z]/i.test(q)) caregiverOr.push({ $and: wordsMatch(words).map((m) => ({ fullName: m })) });
  if (digits.length >= 7) caregiverOr.push({ phone: { $regex: digits.split('').join('\\D*') } });
  if (caregiverOr.length) {
    const caregivers = await CaregiverModel.find({ $or: caregiverOr }).select('_id').limit(50);
    if (caregivers.length) or.push({ caregiverId: { $in: caregivers.map((c) => c._id) } });
  }

  if (!or.length) return { results: [], more: false };
  const children = await ChildModel.find({ $or: or })
    .collation({ locale: 'en', numericOrdering: true })
    .sort({ fullName: 1 })
    .limit(limit * 3);

  // Exact CHIN first, then names that start with the query, then the rest.
  const lower = q.toLowerCase();
  const rank = (c: { chin: string; fullName: string }) =>
    c.chin === chinPart ? 0 : c.fullName.toLowerCase().startsWith(lower) ? 1 : 2;
  // (Array sort is stable, so the database's natural name order — Child 2
  // before Child 10 — survives within each rank.)
  const top = [...children].sort((a, b) => rank(a) - rank(b)).slice(0, limit);

  const caregiverIds = [...new Set(top.map((c) => String(c.caregiverId)))];
  const facilityIds = [...new Set(top.map((c) => String(c.currentFacilityId)))];
  const [cgs, facs] = await Promise.all([
    CaregiverModel.find({ _id: { $in: caregiverIds } }),
    FacilityModel.find({ _id: { $in: facilityIds } })
  ]);
  const cgById = new Map(cgs.map((c) => [String(c._id as Types.ObjectId), c]));
  const facById = new Map(facs.map((f) => [String(f._id as Types.ObjectId), f]));

  const results = top.map((c) => {
    const cg = cgById.get(String(c.caregiverId));
    return {
      chin: c.chin,
      fullName: c.fullName,
      dateOfBirth: c.dateOfBirth,
      status: computeChildStatus(
        c.doses.map((d) => ({
          vaccineCode: d.vaccineCode,
          displayName: d.displayName,
          doseNumber: d.doseNumber,
          dueDate: d.dueDate,
          administeredDate: d.administeredDate ?? null
        })),
        { needsReconciliation: c.needsReconciliation }
      ),
      facility: facById.get(String(c.currentFacilityId))?.name ?? null,
      caregiverName: cg?.fullName ?? null,
      caregiverPhone: cg?.phone ?? null
    };
  });
  return { results, more: children.length > limit };
}
