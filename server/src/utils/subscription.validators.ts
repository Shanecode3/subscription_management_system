import { z } from 'zod';
import {
  booleanField,
  dateField,
  idField,
  moneyField,
  optionalNotes,
  quantityField,
} from './zod-fields';

/**
 * Validation for the subscription lifecycle and the customer portal.
 *
 * The state enum lives here rather than in TypeScript types alone because the
 * transition endpoint would otherwise accept any string and let an invalid
 * status reach PostgreSQL, where the CHECK constraint message names a column
 * instead of a state.
 */

export const SUBSCRIPTION_STATUSES = [
  'Draft',
  'Quotation',
  'Confirmed',
  'Active',
  'Paused',
  'Closed',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_TERMS = [
  'Immediate Payment',
  'Net 15',
  'Net 30',
  'Net 45',
  'Net 60',
] as const;

/** One line of a manually built subscription. Template lines are not posted. */
const subscriptionLineSchema = z
  .object({
    productId: idField('Product'),
    variantId: idField('Variant').nullish(),
    quantity: quantityField('Quantity'),
    /** Omitted means "use the catalogue price plus variant surcharge". */
    unitPrice: moneyField('Unit price').optional(),
  })
  .strict();

/**
 * A subscription is created one of two ways:
 *   - from a quotation template (its plan and lines are copied), or
 *   - manually, with an explicit plan and at least one line.
 * Sending both is ambiguous, so it is refused rather than silently preferred.
 */
export const createSubscriptionSchema = z
  .object({
    customerId: idField('Customer'),
    templateId: idField('Quotation template').optional(),
    planId: idField('Plan').optional(),
    startDate: dateField('Start date'),
    expiryDate: dateField('Expiry date').nullish(),
    paymentTerms: z
      .enum(PAYMENT_TERMS, {
        errorMap: () => ({ message: `Payment terms must be one of: ${PAYMENT_TERMS.join(', ')}.` }),
      })
      .optional(),
    notes: optionalNotes,
    lines: z
      .array(subscriptionLineSchema)
      .min(1, 'Add at least one product line to the subscription.')
      .max(50, 'A subscription can contain at most 50 product lines.')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.templateId === undefined) {
      if (value.planId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['planId'],
          message: 'Choose a plan, or start from a quotation template.',
        });
      }
      if (value.lines === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lines'],
          message: 'Add at least one product line, or start from a quotation template.',
        });
      }
    } else if (value.planId !== undefined || value.lines !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateId'],
        message: 'Choose either a quotation template or a plan with lines, not both.',
      });
    }

    if (value.expiryDate && value.expiryDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiryDate'],
        message: 'Expiry date must be on or after the start date.',
      });
    }
  });

export const updateStatusSchema = z
  .object({
    status: z.enum(SUBSCRIPTION_STATUSES, {
      errorMap: () => ({
        message: `Status must be one of: ${SUBSCRIPTION_STATUSES.join(', ')}.`,
      }),
    }),
    reason: z.string().trim().max(500, 'Reason must be 500 characters or fewer.').optional(),
  })
  .strict();

/** Customer/staff action body: a reason is optional, so an empty body is valid. */
export const lifecycleActionSchema = z
  .object({
    reason: z.string().trim().max(500, 'Reason must be 500 characters or fewer.').optional(),
  })
  .strict();

export const toggleAddonSchema = z
  .object({
    lineId: idField('Line'),
    isActive: booleanField('Add-on state'),
  })
  .strict();

export const renewSubscriptionSchema = z
  .object({
    startDate: dateField('New start date').optional(),
    expiryDate: dateField('New expiry date').nullish(),
    paymentTerms: z
      .enum(PAYMENT_TERMS, {
        errorMap: () => ({ message: `Payment terms must be one of: ${PAYMENT_TERMS.join(', ')}.` }),
      })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startDate && value.expiryDate && value.expiryDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiryDate'],
        message: 'New expiry date must be on or after the new start date.',
      });
    }
  });

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type SubscriptionLineInput = NonNullable<CreateSubscriptionInput['lines']>[number];
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type ToggleAddonInput = z.infer<typeof toggleAddonSchema>;
export type RenewSubscriptionInput = z.infer<typeof renewSubscriptionSchema>;
export type LifecycleActionInput = z.infer<typeof lifecycleActionSchema>;
