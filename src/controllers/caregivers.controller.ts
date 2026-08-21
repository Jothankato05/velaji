import type { Request, Response } from 'express';
import { CaregiverModel } from '../models/Caregiver';
import { AppError } from '../utils/AppError';

export async function createCaregiver(req: Request, res: Response) {
  const { fullName, phone, relationship } = req.body ?? {};
  if (!fullName || !phone) {
    throw new AppError('fullName and phone are required');
  }

  const caregiver = await CaregiverModel.create({ fullName, phone, relationship });
  res.status(201).json(caregiver);
}
