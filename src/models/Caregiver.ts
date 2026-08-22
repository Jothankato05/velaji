import { Schema, model, type InferSchemaType } from 'mongoose';

const caregiverSchema = new Schema(
  {
    fullName: { type: String, required: true },
    // Optional at the data level: some caregivers genuinely have no reachable
    // number. Such a child can't be reminded by SMS, so if it falls overdue it
    // goes to the follow-up queue (NCIHAP §7) rather than silently slipping.
    // Registration (createCaregiver) still asks for a phone.
    phone: { type: String, default: '' },
    relationship: { type: String, default: 'parent' }
  },
  { timestamps: true }
);

export type CaregiverDoc = InferSchemaType<typeof caregiverSchema>;
export const CaregiverModel = model('Caregiver', caregiverSchema);
