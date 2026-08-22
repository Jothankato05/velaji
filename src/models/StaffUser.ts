import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const staffUserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    role: { type: String, enum: ['verifier', 'staff', 'admin'], default: 'staff' }
  },
  { timestamps: true }
);

export type StaffUserDoc = InferSchemaType<typeof staffUserSchema>;
export type StaffUserHydrated = HydratedDocument<StaffUserDoc>;
export const StaffUserModel = model('StaffUser', staffUserSchema);
