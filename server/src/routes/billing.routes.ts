import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/validate.middleware';
import { sendSuccess } from '../utils/response';
import * as billingEngine from '../services/billing.engine';

export const billingRouter = Router();

billingRouter.use(authenticate);

/** Billing is a staff operation; a customer never sees another account's run. */
billingRouter.use(requireRole('ADMIN', 'STAFF'));

/**
 * What the next run would do, computed from live rows and writing nothing.
 * The preview and the run share the same evaluation helpers, so the figures on
 * screen are the figures that will be invoiced.
 */
billingRouter.get(
  '/pending',
  asyncHandler(async (_req, res) => {
    const preview = await billingEngine.previewBillingDay();
    return sendSuccess(res, preview);
  }),
);

billingRouter.post(
  '/run-billing-day',
  asyncHandler(async (req, res) => {
    const result = await billingEngine.runBillingDay(req.user!);

    // A run that failed a contract must never report "nothing was due" — that
    // message hid a real failure once and sent the operator looking in the wrong
    // place.
    const summary =
      result.failedCount > 0
        ? `Generated ${result.generatedCount} invoice(s), but ${result.failedCount} contract(s) failed — see the run detail below.`
        : result.generatedCount === 0
          ? `No invoices were due. ${result.closedCount} contract(s) auto-closed.`
          : `Generated ${result.generatedCount} invoice(s), skipped ${result.skippedCount}, closed ${result.closedCount} contract(s).`;

    return sendSuccess(res, result, 200, summary);
  }),
);
