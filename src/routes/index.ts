import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
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

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true, service: 'ncihap-prototype' }));

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

// Public — reached by scanning a printed card's QR code, gated by the
// signed token instead of staff auth.
apiRouter.get('/api/verify/:chin', asyncHandler(verifyChin));
