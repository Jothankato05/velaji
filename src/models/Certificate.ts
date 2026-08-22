import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Issued the moment a child's routine schedule is fully complete — this is the
 * payoff of NCIHAP: completing immunisation UNLOCKS a defined period of
 * NHIA-supported "Healthy Start" child health coverage (§12–14). The child's
 * completed vaccination becomes their gateway into organised healthcare.
 *
 * The coverage is granted here as a first-class record (programme, months,
 * window) so the system can show the unlock and, later, renewal. But it is NOT
 * a real NHIA financial/insurance integration — that is a genuine national
 * policy undertaking. `nhiaIntegrationStatus: 'not_connected'` keeps that seam
 * explicit: the reward is recorded in-system; no real insurer is wired up yet.
 */
const certificateSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, unique: true },
    chin: { type: String, required: true },
    verificationCode: { type: String, required: true, unique: true },
    issuedAt: { type: Date, required: true },

    // The unlocked reward — NHIA "Healthy Start" coverage (§12).
    coverageProgramme: { type: String, default: 'Healthy Start' },
    coverageMonths: { type: Number, default: 12 },
    coverageStartsAt: { type: Date, required: true },
    coverageExpiresAt: { type: Date, required: true },

    // Explicit, visible seam: the reward is recorded, but no real NHIA/insurer
    // system is connected.
    nhiaIntegrationStatus: { type: String, default: 'not_connected' }
  },
  { timestamps: true }
);

export type CertificateDoc = InferSchemaType<typeof certificateSchema>;
export const CertificateModel = model('Certificate', certificateSchema);
