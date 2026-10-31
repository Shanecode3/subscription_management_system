import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import {
  lifecycleActionSchema,
  renewSubscriptionSchema,
  toggleAddonSchema,
} from '../utils/subscription.validators';
import * as subscriptionService from '../services/subscription.service';

export const portalRouter = Router();

portalRouter.use(authenticate);
portalRouter.use(requireRole('CUSTOMER'));

/**
 * The customer portal. Every handler passes `req.user` straight to the service,
 * which supplies the tenant filter itself — the customer id is never read from
 * the URL or the query string, so a customer cannot ask for another account's
 * contract even by guessing an id.
 */
portalRouter.get(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const subscriptions = await subscriptionService.listSubscriptions(req.user!, {});
    return sendSuccess(res, subscriptions);
  }),
);

portalRouter.get(
  '/subscriptions/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.getSubscription(id, req.user!);
    return sendSuccess(res, subscription);
  }),
);

/** Switching an add-on off writes a zero amount to the line, not a deletion. */
portalRouter.patch(
  '/subscriptions/:id/addons',
  validateBody(toggleAddonSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.setAddon(id, req.body, req.user!);
    return sendSuccess(
      res,
      subscription,
      200,
      req.body.isActive ? 'Add-on switched on.' : 'Add-on switched off.',
    );
  }),
);

portalRouter.post(
  '/subscriptions/:id/pause',
  validateBody(lifecycleActionSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.pauseSubscription(id, req.user!, req.body.reason);
    return sendSuccess(res, subscription, 200, 'Subscription paused.');
  }),
);

portalRouter.post(
  '/subscriptions/:id/resume',
  validateBody(lifecycleActionSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.resumeSubscription(id, req.user!, req.body.reason);
    return sendSuccess(res, subscription, 200, 'Subscription resumed.');
  }),
);

portalRouter.post(
  '/subscriptions/:id/early-close',
  validateBody(lifecycleActionSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.earlyCloseSubscription(
      id,
      req.user!,
      req.body.reason,
    );
    return sendSuccess(res, subscription, 200, 'Subscription closed.');
  }),
);

portalRouter.post(
  '/subscriptions/:id/renew',
  validateBody(renewSubscriptionSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Subscription id');
    const subscription = await subscriptionService.renewSubscription(id, req.body, req.user!);
    return sendSuccess(res, subscription, 200, 'Subscription renewed.');
  }),
);
