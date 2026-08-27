import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth, requireRole } from '../middleware/requireAuth';
import { rateLimit } from '../middleware/rateLimit';
import { auditChildAccess } from '../middleware/auditChildAccess';
import { login, me } from '../controllers/auth.controller';
import { createFacility, listFacilities, nearestFacility } from '../controllers/facilities.controller';
import { createCaregiver } from '../controllers/caregivers.controller';
import {
  registerChild,
  getChild,
  recordDose,
  getCard,
  getCertificate,
  getJourney,
  recordHandoff
} from '../controllers/children.controller';
import { verifyChin } from '../controllers/verify.controller';
import { familyJourney } from '../controllers/family.controller';
import { triggerReminderCycle, getChildReminderLog } from '../controllers/reminders.controller';
import { getEscalations, postResolveEscalation } from '../controllers/escalations.controller';
import { postTerminalLookup, getChildAccessLog } from '../controllers/terminal.controller';
import { getSummary, getStockForecast, getTrend, getOutliers, getActivity, getCoverageByState, getMilestones } from '../controllers/dashboard.controller';
import { getPull, postPush } from '../controllers/sync.controller';
import { getRecovery } from '../controllers/recovery.controller';

export const apiRouter = Router();

// --- Public routes. These MUST be registered before the requireAuth layer
// below — Express middleware applies in registration order, and an
// unscoped `.use(requireAuth)` registered earlier would intercept every
// path that comes after it in the stack, public or not. Getting this order
// wrong silently 401s every webhook/public endpoint mounted after it. ---
apiRouter.get('/health', (_req, res) => res.json({ ok: true, service: 'ncihap' }));

// Throttle login to blunt credential stuffing / brute force: 10 tries per IP
// per 15 minutes. A legitimate health worker never trips this; an attacker
// spraying passwords does.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
apiRouter.post('/api/auth/login', loginLimiter, asyncHandler(login));

// The public, card-gated endpoints guess-proof their CHIN+token pair, but a
// throttle stops anyone trying to enumerate tokens at scale.
const cardLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Reached by scanning a printed card's QR code — gated by the card's own
// signed token, not staff auth, because a caregiver or a receiving
// facility with no account still needs to be able to check status.
apiRouter.get('/api/verify/:chin', cardLimiter, asyncHandler(verifyChin));

// MyChild family app — the parent's own view, reached with their card
// (CHIN + signed token). Public like verify; the card is the key.
apiRouter.get('/api/family/:chin', cardLimiter, asyncHandler(familyJourney));

// --- Everything below requires a staff bearer token. ---
apiRouter.use(requireAuth);

apiRouter.get('/api/auth/me', asyncHandler(me));

apiRouter.post('/api/facilities', asyncHandler(createFacility));
apiRouter.get('/api/facilities', asyncHandler(listFacilities));
apiRouter.get('/api/facilities/nearest', asyncHandler(nearestFacility));

apiRouter.post('/api/caregivers', asyncHandler(createCaregiver));

// An individual child's record is care data, not something every authenticated
// account may read. Verifiers get the role-scoped, audited §16 headline via the
// terminal (/api/terminal/lookup) — never the full record here. Staff and
// admins may read/update it (the card is designed to work at any facility, so
// staff are deliberately NOT facility-scoped), and every access is written to
// the §24 audit trail via auditChildAccess.
const childRecord = [auditChildAccess, requireRole('staff', 'admin')];

apiRouter.post('/api/children', requireRole('staff', 'admin'), asyncHandler(registerChild));
apiRouter.get('/api/children/:chin', ...childRecord, asyncHandler(getChild));
apiRouter.post('/api/children/:chin/doses', ...childRecord, asyncHandler(recordDose));
apiRouter.get('/api/children/:chin/card.svg', ...childRecord, asyncHandler(getCard));
apiRouter.get('/api/children/:chin/certificate', ...childRecord, asyncHandler(getCertificate));
apiRouter.get('/api/children/:chin/journey', ...childRecord, asyncHandler(getJourney));
apiRouter.post('/api/children/:chin/handoff', ...childRecord, asyncHandler(recordHandoff));
apiRouter.get('/api/children/:chin/reminders', ...childRecord, asyncHandler(getChildReminderLog));

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
apiRouter.get('/api/dashboard/activity', requireRole('admin'), asyncHandler(getActivity));
apiRouter.get('/api/dashboard/coverage-by-state', requireRole('admin'), asyncHandler(getCoverageByState));
apiRouter.get('/api/dashboard/milestones', requireRole('admin'), asyncHandler(getMilestones));

// The recovery call list behind the drill-down — individual overdue children in
// a scope, for the worker who will act on them. Staff/admin only (it carries
// names and contact numbers, unlike the aggregate dashboard).
apiRouter.get('/api/recovery', requireRole('staff', 'admin'), asyncHandler(getRecovery));

// Offline-first sync (NCIHAP §9): a health-worker device (staff/admin) pulls
// the children it needs to work offline, and pushes queued transactions —
// idempotently — when connectivity returns. Verifiers don't sync.
apiRouter.get('/api/sync/pull', requireRole('staff', 'admin'), asyncHandler(getPull));
apiRouter.post('/api/sync/push', requireRole('staff', 'admin'), asyncHandler(postPush));
