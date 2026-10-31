import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { createStaffSchema } from '../utils/validators';
import { sendSuccess } from '../utils/response';
import * as userService from '../services/user.service';

export const adminRouter = Router();

// Every route below requires a valid session.
adminRouter.use(authenticate);

/** Admin only — the single staff-creation gate from the brief. */
adminRouter.post(
  '/users/staff',
  requireRole('ADMIN'),
  validateBody(createStaffSchema),
  asyncHandler(async (req, res) => {
    const staff = await userService.createStaffMember(req.body, req.user!);
    return sendSuccess(res, staff, 201, 'Staff account created.');
  }),
);

/** Admin and Staff can view the team and customer list. Customers cannot. */
adminRouter.get(
  '/users',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (_req, res) => {
    const users = await userService.listAllUsers();
    return sendSuccess(res, users);
  }),
);
