import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { createTemplateSchema } from '../utils/catalog.validators';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import * as templateService from '../services/template.service';

export const templateRouter = Router();

templateRouter.use(authenticate);

/** Internal sales tooling — never exposed to the customer portal. */
templateRouter.get(
  '/',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    const templates = await templateService.listTemplates(req.user!);
    return sendSuccess(res, templates);
  }),
);

templateRouter.get(
  '/:id',
  requireRole('ADMIN', 'STAFF'),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Template id');
    const template = await templateService.getTemplate(id, req.user!);
    return sendSuccess(res, template);
  }),
);

templateRouter.post(
  '/',
  requireRole('ADMIN'),
  validateBody(createTemplateSchema),
  asyncHandler(async (req, res) => {
    const template = await templateService.createTemplate(req.body, req.user!);
    return sendSuccess(res, template, 201, 'Quotation template created.');
  }),
);
