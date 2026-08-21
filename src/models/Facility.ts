import { Schema, model, type InferSchemaType } from 'mongoose';

const facilitySchema = new Schema(
  {
    name: { type: String, required: true },
    lgaName: { type: String, required: true },
    stateName: { type: String, required: true },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    }
  },
  { timestamps: true }
);

facilitySchema.index({ location: '2d' });

export type FacilityDoc = InferSchemaType<typeof facilitySchema>;
export const FacilityModel = model('Facility', facilitySchema);
