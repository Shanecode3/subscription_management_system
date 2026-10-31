import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/validate.middleware';
import { parseDateFilter, parseIdFilter, parseLimit } from '../utils/query-params';
import { sendSuccess } from '../utils/response';
import * as financeService from '../services/finance.service';

export const financeRouter = Router();

financeRouter.use(authenticate);

/**
 * Revenue is company-wide data, so the gate sits at the router: a customer
 * session never reaches a finance handler. The service checks the role again
 * for any future caller that mounts it elsewhere.
 */
financeRouter.use(requireRole('ADMIN', 'STAFF'));

financeRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const dashboard = await financeService.getDashboard(
      req.user!,
      {
        startDate: parseDateFilter(req.query.startDate, 'Start date', 'startDate'),
        endDate: parseDateFilter(req.query.endDate, 'End date', 'endDate'),
        planId: parseIdFilter(req.query.planId, 'Plan', 'planId'),
        customerId: parseIdFilter(req.query.customerId, 'Customer', 'customerId'),
      },
      parseLimit(req.query.limit) ?? 50,
    );
    return sendSuccess(res, dashboard);
  }),
);

financeRouter.get(
  '/filter-options',
  asyncHandler(async (req, res) => {
    const options = await financeService.getFilterOptions(req.user!);
    return sendSuccess(res, options);
  }),
);
