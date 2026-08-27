import { Schema, model, type InferSchemaType } from 'mongoose';

const facilitySchema = new Schema(
  {
    name: { type: String, required: true },
    // Geographic hierarchy for the National Command Dashboard drill-down
    // (NCIHAP §11: Nigeria → State → LGA → Ward → PHC). wardName is optional
    // because not every deployment captures it; it groups under "(unspecified
    // ward)" when absent.
    wardName: { type: String, default: '' },
    lgaName: { type: String, required: true },
    stateName: { type: String, required: true },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },
    // NCIHAP §18: real supply planning has to account for the infrastructure a
    // facility actually has. In Nigeria ~1 in 5 vaccine fridges are
    // non-functional and ~40% of facilities face daily power outages, so a
    // "doses needed" number is only actionable next to whether the facility can
    // store them.
    coldChainStatus: { type: String, enum: ['functional', 'at_risk', 'down'], default: 'functional' },
    // NCIHAP §19/§20: some settlements (esp. the north-east) are hard to reach
    // or security-compromised and need dedicated outreach rounds rather than a
    // fixed session.
    accessibility: { type: String, enum: ['accessible', 'hard_to_reach', 'security_compromised'], default: 'accessible' }
  },
  { timestamps: true }
);

facilitySchema.index({ location: '2d' });

export type FacilityDoc = InferSchemaType<typeof facilitySchema>;
export const FacilityModel = model('Facility', facilitySchema);
