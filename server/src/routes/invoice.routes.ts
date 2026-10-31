import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import { ValidationError } from '../utils/errors';
import {
  INVOICE_ACTIONS,
  INVOICE_STATUSES,
  invoiceActionSchema,
  type InvoiceStatus,
} from '../utils/billing.validators';
import * as invoiceService from '../services/invoice.service';

export const invoiceRouter = Router();

invoiceRouter.use(authenticate);

function parseStatusFilter(raw: unknown): InvoiceStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'string' && (INVOICE_STATUSES as readonly string[]).includes(raw)) {
    return raw as InvoiceStatus;
  }
  return undefined;
}

function parseOptionalId(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * An unusable date would surface as PostgreSQL's 22007 (invalid_datetime_format)
 * if it reached the query, so it is rejected here with the field name instead.
 */
function parseDateFilter(raw: unknown, label: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ValidationError(`${label} must be a date in YYYY-MM-DD format.`, [
      { field: label.toLowerCase(), message: `Use YYYY-MM-DD, for example 2026-10-31.` },
    ]);
  }
  return raw;
}

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new ValidationError('Limit must be a whole number between 1 and 500.', [
      { field: 'limit', message: 'Choose a limit between 1 and 500.' },
    ]);
  }
  return parsed;
}

/**
 * The tenant filter is not a query parameter: the service forces a customer
 * session onto its own id, so `?customerId=` from a customer is ignored.
 */
invoiceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const invoices = await invoiceService.listInvoices(req.user!, {
      status: parseStatusFilter(req.query.status),
      customerId: parseOptionalId(req.query.customerId),
      from: parseDateFilter(req.query.from, 'From date'),
      to: parseDateFilter(req.query.to, 'To date'),
      limit: parseLimit(req.query.limit),
    });
    return sendSuccess(res, invoices);
  }),
);

invoiceRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Invoice id');
    const invoice = await invoiceService.getInvoice(id, req.user!);
    return sendSuccess(res, invoice);
  }),
);

/**
 * Four explicit paths, one implementation. Printing is an action rather than a
 * page fetch so the audit trail records who handed the document to a customer.
 */
for (const action of INVOICE_ACTIONS) {
  invoiceRouter.post(
    `/:id/${action}`,
    validateBody(invoiceActionSchema),
    asyncHandler(async (req, res) => {
      const id = parsePositiveIntParam(req.params.id, 'Invoice id');
      const invoice = await invoiceService.performInvoiceAction(
        id,
        action,
        req.user!,
        req.body.note,
      );
      return sendSuccess(res, invoice, 200, invoiceService.actionMessage(action));
    }),
  );
}
