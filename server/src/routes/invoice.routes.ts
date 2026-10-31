import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parsePositiveIntParam } from '../utils/params';
import { parseDateFilter, parseLimit, parseOptionalId } from '../utils/query-params';
import { sendSuccess } from '../utils/response';
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

/**
 * Registered before `/:id`, or Express would match "overdue" as an id and the
 * request would fail with a 400 instead of listing the late invoices.
 */
invoiceRouter.get(
  '/overdue',
  asyncHandler(async (req, res) => {
    const invoices = await invoiceService.listOverdueInvoices(
      req.user!,
      parseOptionalId(req.query.customerId),
      parseLimit(req.query.limit),
    );
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
