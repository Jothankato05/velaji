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
