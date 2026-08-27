import type { Request, Response } from 'express';
import {
  geographicSummary,
  stockForecast,
  administrationTrend,
  facilityOutliers,
  recentActivity,
  coverageByState,
  milestoneAttainment,
  type GeoFilter
} from '../services/dashboard.service';
import { AppError } from '../utils/AppError';

function readFilter(req: Request): GeoFilter {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return { state: str(req.query.state), lga: str(req.query.lga), ward: str(req.query.ward) };
}

/** NCIHAP §11 drill-down: Nigeria (no filter) → State → LGA → Ward → PHC. */
export async function getSummary(req: Request, res: Response) {
  res.json(await geographicSummary(readFilter(req)));
}

export async function getStockForecast(req: Request, res: Response) {
  const weeks = Number(req.query.weeks ?? 4);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new AppError('weeks must be an integer between 1 and 52');
  }
  res.json(await stockForecast(weeks, readFilter(req)));
}

export async function getTrend(req: Request, res: Response) {
  const weeks = Number(req.query.weeks ?? 8);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new AppError('weeks must be an integer between 1 and 52');
  }
  res.json(await administrationTrend(weeks));
}

export async function getOutliers(_req: Request, res: Response) {
  const outliers = await facilityOutliers();
  res.json({ count: outliers.length, outliers });
}

export async function getActivity(_req: Request, res: Response) {
  res.json({ events: await recentActivity(12) });
}

/** Coverage by priority state: every state ranked worst-first with a flag. */
export async function getCoverageByState(_req: Request, res: Response) {
  res.json(await coverageByState());
}

/** Staged-incentive attainment funnel (§14): children reaching each milestone. */
export async function getMilestones(_req: Request, res: Response) {
  res.json(await milestoneAttainment());
}
