import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const doseSchema = new Schema(
  {
    vaccineCode: { type: String, required: true },
    displayName: { type: String, required: true },
    doseNumber: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    administeredDate: { type: Date, default: null },
    administeredAtFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null }
  },
  { _id: false }
);

const childSchema = new Schema(
  {
    chin: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true },
    sex: { type: String, enum: ['male', 'female'], required: true },
    dateOfBirth: { type: Date, required: true },
    caregiverId: { type: Schema.Types.ObjectId, ref: 'Caregiver', required: true },
    homeFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    currentFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    doses: { type: [doseSchema], default: [] },
    completedAt: { type: Date, default: null },
    // NCIHAP §19: home births are not excluded. Where the child was born, and
    // through which channel they entered the registry — a mobile team or CHW in
    // the field is as valid an entry point as a PHC.
    birthSetting: { type: String, enum: ['facility', 'home', 'other'], default: 'facility' },
    registrationChannel: {
      type: String,
      enum: ['phc', 'hospital', 'chw', 'mobile_team', 'outreach', 'npc'],
      default: 'phc'
    },
    // NCIHAP §10: record is unverified/incomplete and needs reconciliation
    // (e.g. an offline record not yet reconciled, or a data conflict). Drives
    // the GREY status. Defaults false — a normal record is never GREY just for
    // being overdue.
    needsReconciliation: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export type ChildDoc = InferSchemaType<typeof childSchema>;
export type ChildHydrated = HydratedDocument<ChildDoc>;
export const ChildModel = model('Child', childSchema);
