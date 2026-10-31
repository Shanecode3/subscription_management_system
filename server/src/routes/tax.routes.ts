import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import {
  createTaxRuleSchema,
  updateTaxRuleSchema,
} from '../utils/billing.validators';
import * as taxService from '../services/tax.service';

export const taxRouter = Router();

taxRouter.use(authenticate);

/**
 * Reading is open to every signed-in role: a customer needs to see the rate on
 * their own invoice, and the portal shows the active rates next to the plan.
 * Writing is Admin-only, because a tax rate changes every invoice issued after
 * it and that is a financial decision, not a day-to-day one.
 */
taxRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rules = await taxService.listTaxRules(req.user!);
    return sendSuccess(res, rules);
  }),
);

taxRouter.post(
  '/',
  requireRole('ADMIN'),
  validateBody(createTaxRuleSchema),
  asyncHandler(async (req, res) => {
    const rule = await taxService.createTaxRule(req.body, req.user!);
    return sendSuccess(res, rule, 201, `Tax rule "${rule.name}" created.`);
  }),
);

taxRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validateBody(updateTaxRuleSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Tax rule id');
    const rule = await taxService.updateTaxRule(id, req.body, req.user!);
    return sendSuccess(res, rule, 200, `Tax rule "${rule.name}" updated.`);
  }),
);

/** Retiring keeps the row for the invoices that already snapshot it. */
taxRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Tax rule id');
    const rule = await taxService.retireTaxRule(id, req.user!);
    return sendSuccess(res, rule, 200, `Tax rule "${rule.name}" retired.`);
  }),
);
