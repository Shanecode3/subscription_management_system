import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/validate.middleware';
import { sendSuccess } from '../utils/response';
import * as dashboardService from '../services/dashboard.service';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

/** The summary spans every customer's billing, so it is an internal view. */
dashboardRouter.use(requireRole('ADMIN', 'STAFF'));

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const summary = await dashboardService.getSummary(req.user!);
    return sendSuccess(res, summary);
  }),
);
