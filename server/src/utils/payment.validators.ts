import { z } from 'zod';
import { dateField, idField, moneyField, optionalNotes } from './zod-fields';

/**
 * Validation for the payment ledger.
 *
 * The four rails come straight from the acceptance criteria and match the
 * PostgreSQL CHECK on `payments.payment_method`, so an invalid method is
 * answered with a readable message instead of a constraint violation.
 */

export const PAYMENT_METHODS = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Recording a payment names the invoice it settles. The remaining rules —
 * status, remaining balance, and the two date bounds — need the invoice row and
 * therefore live in `payment.service`, where they can be checked inside the same
 * transaction that writes the payment.
 */
export const recordPaymentSchema = z
  .object({
    invoiceId: idField('Invoice'),
    amount: moneyField('Payment amount').refine(
      (value) => value > 0,
      'Payment amount must be greater than zero.',
    ),
    method: z.enum(PAYMENT_METHODS, {
      errorMap: () => ({
        message: 'Payment method must be Bank Transfer, Credit Card, UPI or Cash.',
      }),
    }),
    date: dateField('Payment date'),
    note: optionalNotes,
  })
  .strict();

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
