import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const staffUserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    role: { type: String, enum: ['verifier', 'staff', 'admin'], default: 'staff' },
    // Primers ID this staff member connected (its account number for Velaji). Staff accounts are
    // issued by admins, so a Primers ID can only sign in once its owner has connected it.
    primersIdSub: { type: String, unique: true, sparse: true, select: false }
  },
  { timestamps: true }
);

export type StaffUserDoc = InferSchemaType<typeof staffUserSchema>;
export type StaffUserHydrated = HydratedDocument<StaffUserDoc>;
export const StaffUserModel = model('StaffUser', staffUserSchema);
