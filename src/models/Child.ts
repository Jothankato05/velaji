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
    // 'antenatal' means the record was opened during pregnancy and converted at
    // birth (see models/Pregnancy.ts) — the child arrived already known, rather
    // than being registered for the first time after the fact.
    registrationChannel: {
      type: String,
      enum: ['phc', 'hospital', 'chw', 'mobile_team', 'outreach', 'npc', 'antenatal'],
      default: 'phc'
    },
    /**
     * Civil registration status (NCIHAP §4).
     *
     * The zero-dose child and the unregistered child are overwhelmingly the same
     * child: only ~57% of Nigerian under-five births are registered, and the
     * distribution mirrors immunisation coverage almost exactly (Lagos 94% /
     * FCT 87% against Jigawa 23.6% / Sokoto 22.5%), for the same reason — born
     * at home, no skilled attendant, never written down.
     *
     * That has a consequence the programme has to solve rather than observe:
     * BHCPF's Vulnerable Group Fund covers under-fives, but enrolment runs on
     * the social register and the NIN. No birth registration means no NIN, which
     * means the children with the strongest claim on the fund cannot make it.
     *
     * So a health contact becomes a route to legal identity. Velaji does NOT
     * register births — NPC does — but it knows the child exists, and can refer
     * and then carry the resulting numbers. 'referred' means handed to NPC;
     * 'registered' means NPC returned a birth registration number.
     */
    birthRegistration: {
      status: {
        type: String,
        enum: ['not_registered', 'referred', 'registered'],
        default: 'not_registered'
      },
      registrationNumber: { type: String, default: '' },
      nin: { type: String, default: '' },
      referredAt: { type: Date, default: null },
      registeredAt: { type: Date, default: null }
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
