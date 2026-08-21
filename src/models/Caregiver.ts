import { Schema, model, type InferSchemaType } from 'mongoose';

const caregiverSchema = new Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    relationship: { type: String, default: 'parent' }
  },
  { timestamps: true }
);

export type CaregiverDoc = InferSchemaType<typeof caregiverSchema>;
export const CaregiverModel = model('Caregiver', caregiverSchema);
