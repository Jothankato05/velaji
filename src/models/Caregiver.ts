import { Schema, model, type InferSchemaType } from 'mongoose';

const caregiverSchema = new Schema(
  {
    fullName: { type: String, required: true },
    // Optional at the data level: some caregivers genuinely have no reachable
    // number. Such a child can't be reminded by SMS, so if it falls overdue it
    // goes to the follow-up queue (NCIHAP §7) rather than silently slipping.
    // Registration (createCaregiver) still asks for a phone.
    phone: { type: String, default: '' },
    relationship: { type: String, default: 'parent' },
    // The caregiver's National Identification Number, if they have one.
    // Optional and never required to register a child — but it is the anchor
    // NIMC actually uses: a child's birth registration is linked through the
    // mother's identity before the child's own NIN is issued. Capturing it here
    // is what lets a health record become a route to legal identity.
    nin: { type: String, default: '' }
  },
  { timestamps: true }
);

export type CaregiverDoc = InferSchemaType<typeof caregiverSchema>;
export const CaregiverModel = model('Caregiver', caregiverSchema);
