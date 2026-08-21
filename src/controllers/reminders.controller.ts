import type { Request, Response } from 'express';
import { ChildModel } from '../models/Child';
import { ReminderLogModel } from '../models/ReminderLog';
import { reminderService } from '../services/reminder.service';
import { normalizeChin } from '../services/chin.service';
import { AppError } from '../utils/AppError';

/** Admin-only: run a reminder cycle right now and return what it did. */
export async function triggerReminderCycle(_req: Request, res: Response) {
  const summary = await reminderService.runCycle();
  res.json(summary);
}

/** Staff: the reminder history for one child, newest first. */
export async function getChildReminderLog(req: Request, res: Response) {
  const chinParam = req.params.chin;
  const chin = normalizeChin(Array.isArray(chinParam) ? chinParam[0] : chinParam);

  const child = await ChildModel.findOne({ chin });
  if (!child) throw new AppError(`No child found with CHIN ${chin}`, 404);

  const logs = await ReminderLogModel.find({ childId: child._id }).sort({ sentAt: -1 });
  res.json(logs);
}
