import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * A record of a child's care moving from one facility to another —
 * e.g. a family relocates, or a caregiver reports at a facility that isn't
 * the child's registered home facility. Geolocation on both ends lets a
 * receiving facility confirm this is a plausible handoff (not just a typo'd
 * CHIN) and lets the system find the nearest facility to a reported location.
 */
const facilityHandoffSchema = new Schema(
  {
    childId: { type: Schema.Types.ObjectId, ref: 'Child', required: true },
    fromFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    toFacilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
    reportedLocation: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    reason: { type: String, default: '' },
    handoffAt: { type: Date, required: true }
  },
  { timestamps: true }
);

export type FacilityHandoffDoc = InferSchemaType<typeof facilityHandoffSchema>;
export const FacilityHandoffModel = model('FacilityHandoff', facilityHandoffSchema);
