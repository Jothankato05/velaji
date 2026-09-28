import type { Request, Response } from 'express';
import { CaregiverModel } from '../models/Caregiver';
import { ChildModel } from '../models/Child';
import { AppError } from '../utils/AppError';
import { phoneMatchSource } from '../utils/phone';

export async function createCaregiver(req: Request, res: Response) {
  const { fullName, phone, relationship } = req.body ?? {};
  if (!fullName || !phone) {
    throw new AppError('fullName and phone are required');
  }

  const caregiver = await CaregiverModel.create({ fullName, phone, relationship });
  res.status(201).json(caregiver);
}

/**
 * Parents already registered with this phone number, and their children, so
 * a second child joins the same family instead of creating a duplicate parent.
 */
export async function findCaregiversByPhone(req: Request, res: Response) {
  const source = phoneMatchSource(typeof req.query.phone === 'string' ? req.query.phone : '');
  if (!source) {
    res.json({ caregivers: [] });
    return;
  }
  const caregivers = await CaregiverModel.find({ phone: { $regex: source } }).limit(5);
  const children = await ChildModel.find({ caregiverId: { $in: caregivers.map((c) => c._id) } })
    .select('fullName dateOfBirth chin caregiverId')
    .sort({ dateOfBirth: -1 });
  res.json({
    caregivers: caregivers.map((c) => ({
      _id: c._id,
      fullName: c.fullName,
      phone: c.phone,
      children: children
        .filter((k) => String(k.caregiverId) === String(c._id))
        .map((k) => ({ chin: k.chin, fullName: k.fullName, dateOfBirth: k.dateOfBirth }))
    }))
  });
}
