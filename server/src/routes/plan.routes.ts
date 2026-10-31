import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { createPlanSchema, updatePlanSchema } from '../utils/catalog.validators';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import * as planService from '../services/plan.service';

export const planRouter = Router();

planRouter.use(authenticate);

planRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const plans = await planService.listPlans(req.user!);
    return sendSuccess(res, plans);
  }),
);

planRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Plan id');
    const plan = await planService.getPlan(id, req.user!);
    return sendSuccess(res, plan);
  }),
);

planRouter.post(
  '/',
  requireRole('ADMIN'),
  validateBody(createPlanSchema),
  asyncHandler(async (req, res) => {
    const plan = await planService.createPlan(req.body, req.user!);
    return sendSuccess(res, plan, 201, 'Plan created.');
  }),
);

/** Used by the plan cards to flip a lifecycle flag without editing the rest. */
planRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validateBody(updatePlanSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Plan id');
    const plan = await planService.updatePlan(id, req.body, req.user!);
    return sendSuccess(res, plan, 200, 'Plan updated.');
  }),
);

planRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Plan id');
    const plan = await planService.deactivatePlan(id, req.user!);
    return sendSuccess(res, plan, 200, 'Plan retired. Existing subscriptions are unchanged.');
  }),
);
