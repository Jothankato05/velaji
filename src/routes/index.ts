import { Router } from 'express';
import mongoose from 'mongoose';
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
  getWallet,
  addWalletRecord,
  recordHandoff,
  postReferBirthRegistration,
  postBirthRegistration,
  getChildFhir
} from '../controllers/children.controller';
import { verifyChin } from '../controllers/verify.controller';
import { familyJourney } from '../controllers/family.controller';
import { handleUssdWebhook } from '../controllers/ussd.controller';
import { triggerReminderCycle, getChildReminderLog } from '../controllers/reminders.controller';
import { getEscalations, postResolveEscalation, getDefaultingReasons } from '../controllers/escalations.controller';
import { postTerminalLookup, getChildAccessLog } from '../controllers/terminal.controller';
import { getSummary, getStockForecast, getSupplyPlan, getTrend, getOutliers, getActivity, getCoverageByState, getMilestones, getRegistrationMobility } from '../controllers/dashboard.controller';
import { getPull, postPush } from '../controllers/sync.controller';
import { getRecovery } from '../controllers/recovery.controller';
import { getIntegrityAlerts } from '../controllers/fraud.controller';
import {
  postPregnancy,
  postAncVisit,
  postLinkBirth,
  postClosePregnancy,
  getAntenatalPipeline,
  getAntenatalFollowUp
} from '../controllers/antenatal.controller';

export const apiRouter = Router();

// --- Public routes. These MUST be registered before the requireAuth layer
// below — Express middleware applies in registration order, and an
// unscoped `.use(requireAuth)` registered earlier would intercept every
// path that comes after it in the stack, public or not. Getting this order
// wrong silently 401s every webhook/public endpoint mounted after it. ---
// Liveness: the process is up and serving. Cheap, always 200.
apiRouter.get('/health', (_req, res) => res.json({ ok: true, service: 'ncihap' }));

// Readiness: the process can actually serve traffic (database connected). Load
// balancers / orchestrators should route only when this is 200; a 503 keeps a
// booting or DB-disconnected instance out of rotation.
apiRouter.get('/ready', (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({ ready: dbReady, db: dbReady ? 'connected' : 'unavailable' });
});

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

// USSD access (NCIHAP §8): a basic-phone caregiver dials a short code; the
// telecom gateway POSTs the session here. Public — the gateway is the caller
// and provides the phone number; there is no bearer token.
apiRouter.post('/webhooks/ussd', cardLimiter, asyncHandler(handleUssdWebhook));

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
apiRouter.get('/api/children/:chin/wallet', ...childRecord, asyncHandler(getWallet));
apiRouter.post('/api/children/:chin/wallet', ...childRecord, asyncHandler(addWalletRecord));
apiRouter.post('/api/children/:chin/handoff', ...childRecord, asyncHandler(recordHandoff));
apiRouter.get('/api/children/:chin/reminders', ...childRecord, asyncHandler(getChildReminderLog));

// §4 civil registration: refer the child to NPC, then carry back the birth
// registration number and NIN. The identity link that makes BHCPF enrolment —
// and so the Healthy Start reward — reachable at all.
apiRouter.post('/api/children/:chin/birth-registration/refer', ...childRecord, asyncHandler(postReferBirthRegistration));
apiRouter.post('/api/children/:chin/birth-registration', ...childRecord, asyncHandler(postBirthRegistration));

// §22 interoperability: the child as a FHIR R4 Bundle for the NPHCDA
// Immunization IG — we integrate with EMID rather than duplicating it.
apiRouter.get('/api/children/:chin/fhir', ...childRecord, asyncHandler(getChildFhir));

// Antenatal registration (NCIHAP §19, extended): open the record during
// pregnancy, so the child arrives already known and the caregiver's phone is
// captured before the gap in which children become zero-dose. These carry
// names and contact numbers, so they are staff/admin — not verifiers.
apiRouter.post('/api/pregnancies', requireRole('staff', 'admin'), asyncHandler(postPregnancy));
apiRouter.post('/api/pregnancies/:ancId/visits', requireRole('staff', 'admin'), asyncHandler(postAncVisit));
apiRouter.post('/api/pregnancies/:ancId/link-birth', requireRole('staff', 'admin'), asyncHandler(postLinkBirth));
apiRouter.post('/api/pregnancies/:ancId/close', requireRole('staff', 'admin'), asyncHandler(postClosePregnancy));

// The antenatal follow-up list — pregnancies past their due date the system has
// heard nothing about, and those approaching delivery below four contacts.
apiRouter.get('/api/antenatal/follow-up', requireRole('staff', 'admin'), asyncHandler(getAntenatalFollowUp));

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
apiRouter.get('/api/dashboard/supply-plan', requireRole('admin'), asyncHandler(getSupplyPlan));
apiRouter.get('/api/dashboard/trend', requireRole('admin'), asyncHandler(getTrend));
apiRouter.get('/api/dashboard/outliers', requireRole('admin'), asyncHandler(getOutliers));
apiRouter.get('/api/dashboard/activity', requireRole('admin'), asyncHandler(getActivity));
apiRouter.get('/api/dashboard/coverage-by-state', requireRole('admin'), asyncHandler(getCoverageByState));
apiRouter.get('/api/dashboard/milestones', requireRole('admin'), asyncHandler(getMilestones));
apiRouter.get('/api/dashboard/registration-mobility', requireRole('admin'), asyncHandler(getRegistrationMobility));
apiRouter.get('/api/dashboard/defaulting-reasons', requireRole('admin'), asyncHandler(getDefaultingReasons));
// The antenatal pipeline: children not yet born — how many are coming, where,
// and which are already predicted to be missed. Aggregate only (§24).
apiRouter.get('/api/dashboard/antenatal', requireRole('admin'), asyncHandler(getAntenatalPipeline));

// Fraud/data-integrity monitoring (NCIHAP §17): abnormal recording patterns
// flagged for human review. Admin-only.
apiRouter.get('/api/fraud/alerts', requireRole('admin'), asyncHandler(getIntegrityAlerts));

// The recovery call list behind the drill-down — individual overdue children in
// a scope, for the worker who will act on them. Staff/admin only (it carries
// names and contact numbers, unlike the aggregate dashboard).
apiRouter.get('/api/recovery', requireRole('staff', 'admin'), asyncHandler(getRecovery));

// Offline-first sync (NCIHAP §9): a health-worker device (staff/admin) pulls
// the children it needs to work offline, and pushes queued transactions —
// idempotently — when connectivity returns. Verifiers don't sync.
apiRouter.get('/api/sync/pull', requireRole('staff', 'admin'), asyncHandler(getPull));
apiRouter.post('/api/sync/push', requireRole('staff', 'admin'), asyncHandler(postPush));
