import { FacilityModel } from '../models/Facility';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Finds the closest known facility to a reported location — used both to
 * suggest a receiving facility for a handoff, and to sanity-check that a
 * reported handoff location is plausible.
 */
export async function findNearestFacility(location: { lat: number; lng: number }, excludeId?: string) {
  const facilities = await FacilityModel.find(excludeId ? { _id: { $ne: excludeId } } : {});
  let nearest: { facility: (typeof facilities)[number]; distanceKm: number } | null = null;

  for (const facility of facilities) {
    if (!facility.location) continue; // defensive: schema requires it, but don't trust that blindly
    const distanceKm = haversineKm(location, facility.location);
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { facility, distanceKm };
    }
  }

  return nearest;
}
