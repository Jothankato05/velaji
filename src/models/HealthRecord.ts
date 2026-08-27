import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * A single entry in the Child Health Wallet (NCIHAP §21). The wallet grows the
 * child-health account beyond immunisation into other authorised domains
 * (growth, Vitamin A, nutrition, development, referrals, labs, …) progressively.
 * Immunisation and NHIA status are derived from existing records, not stored
 * here; everything else a health worker records lands as one of these entries.
 */
export const HEALTH_DOMAINS = [
  'growth',
  'vitamin_a',
  'nutrition',
  'malaria',
  'sickle_cell',
  'newborn_screening',
  'development',
  'referral',
  'lab',
  'school_health'
] as const;

export type HealthDomain = (typeof HEALTH_DOMAINS)[number];

const healthRecordSchema = new Schema(
  {
    chin: { type: String, required: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true },
    domain: { type: String, enum: HEALTH_DOMAINS, required: true },
    title: { type: String, required: true, trim: true }, // e.g. "Weight-for-age"
    value: { type: String, required: true, trim: true }, // e.g. "7.2 kg · on track"
    note: { type: String, default: '' },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    recordedBy: { type: String, required: true },
    recordedByRole: { type: String, enum: ['verifier', 'staff', 'admin', 'system'], required: true },
    recordedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

healthRecordSchema.index({ childId: 1, recordedAt: -1 });

export type HealthRecordDoc = InferSchemaType<typeof healthRecordSchema>;
export const HealthRecordModel = model('HealthRecord', healthRecordSchema);
