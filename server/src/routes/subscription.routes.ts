import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import {
  createSubscriptionSchema,
  SUBSCRIPTION_STATUSES,
  updateStatusSchema,
  type SubscriptionStatus,
} from '../utils/subscription.validators';
import * as subscriptionService from '../services/subscription.service';

export const subscriptionRouter = Router();

subscriptionRouter.use(authenticate);

/**
 * Customers reach their own contracts through `/portal/subscriptions`. This
 * router is the internal one: listing every contract, moving it through the
 * state machine, and creating one from a template or by hand.
 */
subscriptionRouter.use(requireRole('ADMIN', 'STAFF'));

function parseStatusFilter(raw: unknown): SubscriptionStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(raw)) {
    return raw as SubscriptionStatus;
  }
  return undefined;
}

function parseOptionalId(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

subscriptionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const subscriptions = await subscriptionService.listSubscriptions(req.user!, {
      status: parseStatusFilter(req.query.status),
      customerId: parseOptionalId(req.query.customerId),
    });
    return sendSuccess(res, subscriptions);
  }),
);

subscriptionRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.getSubscription(id, req.user!);
    return sendSuccess(res, subscription);
  }),
);

subscriptionRouter.post(
  '/',
  validateBody(createSubscriptionSchema),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.createSubscription(req.body, req.user!);
    return sendSuccess(res, subscription, 201, 'Subscription created.');
  }),
);

/**
 * Every state change goes through one endpoint so the transition table and the
 * plan flags are enforced in exactly one place, whether the move came from the
 * staff board or from a customer action.
 */
subscriptionRouter.put(
  '/:id/status',
  validateBody(updateStatusSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.transitionStatus(id, req.body, req.user!);
    return sendSuccess(res, subscription, 200, `Subscription is now ${subscription.status}.`);
  }),
);
