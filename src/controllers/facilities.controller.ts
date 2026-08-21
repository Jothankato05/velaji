import type { Request, Response } from 'express';
import { FacilityModel } from '../models/Facility';
import { findNearestFacility } from '../services/handoff.service';
import { AppError } from '../utils/AppError';

export async function createFacility(req: Request, res: Response) {
  const { name, lgaName, stateName, lat, lng } = req.body ?? {};
  if (!name || !lgaName || !stateName || typeof lat !== 'number' || typeof lng !== 'number') {
    throw new AppError('name, lgaName, stateName, lat, lng are required (lat/lng as numbers)');
  }

  const facility = await FacilityModel.create({ name, lgaName, stateName, location: { lat, lng } });
  res.status(201).json(facility);
}

export async function listFacilities(_req: Request, res: Response) {
  const facilities = await FacilityModel.find({}).sort({ createdAt: -1 });
  res.json(facilities);
}

export async function nearestFacility(req: Request, res: Response) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new AppError('lat and lng query params are required');
  }

  const result = await findNearestFacility({ lat, lng });
  if (!result) throw new AppError('No facilities registered yet', 404);
  res.json({ facility: result.facility, distanceKm: Math.round(result.distanceKm * 10) / 10 });
}
