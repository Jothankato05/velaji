import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth, requireRole } from '../middleware/requireAuth';
import { login, me } from '../controllers/auth.controller';
import { createFacility, listFacilities, nearestFacility } from '../controllers/facilities.controller';
import { createCaregiver } from '../controllers/caregivers.controller';
import {
  registerChild,
  getChild,
  recordDose,
  getCard,
  getCertificate,
  recordHandoff
} from '../controllers/children.controller';
import { verifyChin } from '../controllers/verify.controller';
import { triggerReminderCycle, getChildReminderLog } from '../controllers/reminders.controller';
import { getEscalations, postResolveEscalation } from '../controllers/escalations.controller';
import { postTerminalLookup, getChildAccessLog } from '../controllers/terminal.controller';
import { getSummary, getStockForecast, getTrend, getOutliers } from '../controllers/dashboard.controller';
import { getPull, postPush } from '../controllers/sync.controller';

export const apiRouter = Router();

// --- Public routes. These MUST be registered before the requireAuth layer
// below — Express middleware applies in registration order, and an
// unscoped `.use(requireAuth)` registered earlier would intercept every
// path that comes after it in the stack, public or not. Getting this order
// wrong silently 401s every webhook/public endpoint mounted after it. ---
apiRouter.get('/health', (_req, res) => res.json({ ok: true, service: 'velaji' }));
apiRouter.post('/api/auth/login', asyncHandler(login));

// Reached by scanning a printed card's QR code — gated by the card's own
// signed token, not staff auth, because a caregiver or a receiving
// facility with no account still needs to be able to check status.
apiRouter.get('/api/verify/:chin', asyncHandler(verifyChin));

// --- Everything below requires a staff bearer token. ---
apiRouter.use(requireAuth);

apiRouter.get('/api/auth/me', asyncHandler(me));

apiRouter.post('/api/facilities', asyncHandler(createFacility));
apiRouter.get('/api/facilities', asyncHandler(listFacilities));
apiRouter.get('/api/facilities/nearest', asyncHandler(nearestFacility));

apiRouter.post('/api/caregivers', asyncHandler(createCaregiver));

apiRouter.post('/api/children', asyncHandler(registerChild));
apiRouter.get('/api/children/:chin', asyncHandler(getChild));
apiRouter.post('/api/children/:chin/doses', asyncHandler(recordDose));
apiRouter.get('/api/children/:chin/card.svg', asyncHandler(getCard));
apiRouter.get('/api/children/:chin/certificate', asyncHandler(getCertificate));
apiRouter.post('/api/children/:chin/handoff', asyncHandler(recordHandoff));
apiRouter.get('/api/children/:chin/reminders', asyncHandler(getChildReminderLog));

// Admin-only: manually kick a reminder cycle (useful for testing / on-demand runs).
apiRouter.post('/api/reminders/run', requireRole('admin'), asyncHandler(triggerReminderCycle));

// The human-tracing work queue: children the reminder engine gave up texting.
apiRouter.get('/api/escalations', asyncHandler(getEscalations));
apiRouter.post('/api/escalations/:id/resolve', asyncHandler(postResolveEscalation));

// The authorised verification terminal (NCIHAP §16): look a child up by typed
// CHIN or scanned QR, role-scoped, every access audited. Admins can review the
// audit trail (§24) for any child.
apiRouter.post('/api/terminal/lookup', asyncHandler(postTerminalLookup));
apiRouter.get('/api/children/:chin/access-log', requireRole('admin'), asyncHandler(getChildAccessLog));

// National Command Dashboard (NCIHAP §11): aggregated, privacy-protected
// intelligence for authorised decision-makers. Admin-only; no individual
// child data — only counts and rates.
apiRouter.get('/api/dashboard/summary', requireRole('admin'), asyncHandler(getSummary));
apiRouter.get('/api/dashboard/stock-forecast', requireRole('admin'), asyncHandler(getStockForecast));
apiRouter.get('/api/dashboard/trend', requireRole('admin'), asyncHandler(getTrend));
apiRouter.get('/api/dashboard/outliers', requireRole('admin'), asyncHandler(getOutliers));

// Offline-first sync (NCIHAP §9): a health-worker device (staff/admin) pulls
// the children it needs to work offline, and pushes queued transactions —
// idempotently — when connectivity returns. Verifiers don't sync.
apiRouter.get('/api/sync/pull', requireRole('staff', 'admin'), asyncHandler(getPull));
apiRouter.post('/api/sync/push', requireRole('staff', 'admin'), asyncHandler(postPush));
