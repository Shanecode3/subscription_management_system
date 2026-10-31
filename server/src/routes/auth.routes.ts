import { Router } from 'express';
import { env, isProduction } from '../config/env';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '../utils/validators';
import { sendSuccess } from '../utils/response';
import * as authService from '../services/auth.service';

export const authRouter = Router();

authRouter.post(
  '/signup',
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const session = await authService.signup(req.body);
    return sendSuccess(res, session, 201, 'Your account has been created.');
  }),
);

authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const session = await authService.login(req.body);
    return sendSuccess(res, session, 200, 'Signed in successfully.');
  }),
);

authRouter.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const reset = await authService.requestPasswordReset(req.body.email);
    const message =
      'If that email address belongs to an account, a password reset link has been generated and will expire in 1 hour.';

    // The raw token is returned only to a browser running on the same machine,
    // in development, so the flow can be demonstrated without a mail server.
    // A request from anywhere else — or any production build — gets the same
    // answer whether or not the address exists.
    const caller = req.ip ?? '';
    const fromThisMachine =
      caller === '127.0.0.1' || caller === '::1' || caller === '::ffff:127.0.0.1';
    if (!reset || isProduction || !fromThisMachine) {
      return sendSuccess(res, {}, 200, message);
    }

    const resetUrl = `${env.clientOrigin}/reset-password?token=${reset.token}`;
    return sendSuccess(
      res,
      { resetToken: reset.token, resetUrl, expiresAt: reset.expiresAt.toISOString() },
      200,
      message,
    );
  }),
);

authRouter.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body);
    return sendSuccess(res, {}, 200, 'Your password has been updated. Please sign in.');
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await authService.getProfile(req.user!.id);
    return sendSuccess(res, profile);
  }),
);
