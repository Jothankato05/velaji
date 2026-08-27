import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Append-only ledger of every dose-recording event (NCIHAP §17 fraud
 * prevention): who recorded which dose for which child, at which facility, and
 * when — including rejected duplicate attempts. This is the evidence base the
 * abnormal-activity monitor scans (e.g. one worker "vaccinating" an impossible
 * number of children in a short window). Never updated or deleted.
 */
const doseAdministrationSchema = new Schema(
  {
    chin: { type: String, required: true, index: true },
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true },
    vaccineCode: { type: String, required: true },
    doseNumber: { type: Number, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    recordedBy: { type: String, required: true }, // staff username
    recordedByRole: { type: String, enum: ['verifier', 'staff', 'admin', 'system'], required: true },
    // A recording attempt for a dose that was already administered — kept as a
    // fraud/error signal rather than silently dropped.
    duplicate: { type: Boolean, default: false },
    recordedAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

doseAdministrationSchema.index({ recordedBy: 1, recordedAt: -1 });

export type DoseAdministrationDoc = InferSchemaType<typeof doseAdministrationSchema>;
export const DoseAdministrationModel = model('DoseAdministration', doseAdministrationSchema);
