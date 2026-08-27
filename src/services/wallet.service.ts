import { HealthRecordModel, HEALTH_DOMAINS, type HealthDomain } from '../models/HealthRecord';
import { FacilityModel } from '../models/Facility';
import type { StaffRole } from '../utils/token';

/** Human labels for the wallet domains (NCIHAP §21). */
export const DOMAIN_LABELS: Record<HealthDomain, string> = {
  growth: 'Growth monitoring',
  vitamin_a: 'Vitamin A',
  nutrition: 'Nutrition',
  malaria: 'Malaria',
  sickle_cell: 'Sickle-cell screening',
  newborn_screening: 'Newborn screening',
  development: 'Developmental milestones',
  referral: 'Referral',
  lab: 'Laboratory',
  school_health: 'School health'
};

export function isHealthDomain(value: unknown): value is HealthDomain {
  return typeof value === 'string' && (HEALTH_DOMAINS as readonly string[]).includes(value);
}

export interface HealthRecordView {
  id: string;
  domain: HealthDomain;
  domainLabel: string;
  title: string;
  value: string;
  note: string;
  facility: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface AddRecordInput {
  domain: HealthDomain;
  title: string;
  value: string;
  note?: string;
  facilityId?: any;
}

export async function addHealthRecord(
  child: { _id: any; chin: string; currentFacilityId?: any },
  input: AddRecordInput,
  actor: { username: string; role: StaffRole | 'system' },
  now: Date = new Date()
): Promise<HealthRecordView> {
  const record = await HealthRecordModel.create({
    chin: child.chin,
    childId: child._id,
    domain: input.domain,
    title: input.title,
    value: input.value,
    note: input.note ?? '',
    facilityId: input.facilityId ?? child.currentFacilityId ?? null,
    recordedBy: actor.username,
    recordedByRole: actor.role,
    recordedAt: now
  });
  const facility = record.facilityId ? await FacilityModel.findById(record.facilityId) : null;
  return toView(record, facility?.name ?? null);
}

/** The child's wallet: every non-immunisation health record, newest first. */
export async function getHealthRecords(chin: string): Promise<HealthRecordView[]> {
  const records = await HealthRecordModel.find({ chin }).sort({ recordedAt: -1 });
  const facilityIds = [...new Set(records.map((r) => String(r.facilityId ?? '')).filter(Boolean))];
  const facilities = await FacilityModel.find({ _id: { $in: facilityIds } });
  const nameById = new Map(facilities.map((f) => [String(f._id), f.name]));
  return records.map((r) => toView(r, r.facilityId ? nameById.get(String(r.facilityId)) ?? null : null));
}

function toView(r: any, facilityName: string | null): HealthRecordView {
  return {
    id: String(r._id),
    domain: r.domain,
    domainLabel: DOMAIN_LABELS[r.domain as HealthDomain] ?? r.domain,
    title: r.title,
    value: r.value,
    note: r.note ?? '',
    facility: facilityName,
    recordedBy: r.recordedBy,
    recordedAt: (r.recordedAt ?? new Date()).toISOString()
  };
}
