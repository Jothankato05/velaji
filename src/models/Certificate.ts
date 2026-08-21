import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Issued once a child's routine schedule is fully complete. This is
 * deliberately just a completion flag with a verification code — NOT a real
 * NHIA financial/insurance integration. That integration is a genuine
 * national policy undertaking outside what this prototype can or should
 * fake. This record is the seam a real integration would plug into later —
 * an explicit, visible stub rather than a faked connection.
 */
const certificateSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true, unique: true },
    chin: { type: String, required: true },
    verificationCode: { type: String, required: true, unique: true },
    issuedAt: { type: Date, required: true },
    // Explicit, visible seam: no downstream system is wired up yet.
    nhiaIntegrationStatus: { type: String, default: 'not_connected' }
  },
  { timestamps: true }
);

export type CertificateDoc = InferSchemaType<typeof certificateSchema>;
export const CertificateModel = model('Certificate', certificateSchema);
