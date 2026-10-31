import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import { parseDateFilter, parseLimit, parseOptionalId } from '../utils/query-params';
import { sendSuccess } from '../utils/response';
import { recordPaymentSchema } from '../utils/payment.validators';
import * as paymentService from '../services/payment.service';

export const paymentRouter = Router();

paymentRouter.use(authenticate);

/**
 * The payment ledger. Recording is internal-staff work — enforced in the
 * service, because permission is a business rule, not an HTTP concern — while
 * reading is open to the customer who paid, scoped to their own rows.
 */
paymentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const payments = await paymentService.listPayments(req.user!, {
      invoiceId: parseOptionalId(req.query.invoiceId),
      customerId: parseOptionalId(req.query.customerId),
      from: parseDateFilter(req.query.from, 'From date'),
      to: parseDateFilter(req.query.to, 'To date'),
      limit: parseLimit(req.query.limit),
    });
    return sendSuccess(res, payments);
  }),
);

paymentRouter.post(
  '/',
  validateBody(recordPaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await paymentService.recordPayment(req.body, req.user!);
    return sendSuccess(
      res,
      result,
      201,
      paymentService.paymentMessage(result.payment, result.reconciliation.fullyPaid),
    );
  }),
);
