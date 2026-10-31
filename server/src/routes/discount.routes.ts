import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import {
  createDiscountRuleSchema,
  updateDiscountRuleSchema,
} from '../utils/billing.validators';
import * as discountService from '../services/discount.service';

export const discountRouter = Router();

discountRouter.use(authenticate);

/** Staff can see which promotions are live; only Admin can author them. */
discountRouter.use(requireRole('ADMIN', 'STAFF'));

discountRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rules = await discountService.listDiscountRules(req.user!);
    return sendSuccess(res, rules);
  }),
);

/**
 * The Admin-only gate sits on the route as well as in the service, so a Staff
 * session receives 403 before any body is parsed.
 */
discountRouter.post(
  '/',
  requireRole('ADMIN'),
  validateBody(createDiscountRuleSchema),
  asyncHandler(async (req, res) => {
    const rule = await discountService.createDiscountRule(req.body, req.user!);
    return sendSuccess(res, rule, 201, `Discount "${rule.code}" created.`);
  }),
);

discountRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validateBody(updateDiscountRuleSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Discount rule id');
    const rule = await discountService.updateDiscountRule(id, req.body, req.user!);
    return sendSuccess(res, rule, 200, `Discount "${rule.code}" updated.`);
  }),
);

/** Retiring switches the rule off rather than deleting history. */
discountRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Discount rule id');
    const rule = await discountService.retireDiscountRule(id, req.user!);
    return sendSuccess(res, rule, 200, `Discount "${rule.code}" retired.`);
  }),
);
