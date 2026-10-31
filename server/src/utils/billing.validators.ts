import { z } from 'zod';
import {
  booleanField,
  dateField,
  idField,
  moneyField,
  optionalNotes,
  textField,
} from './zod-fields';

/**
 * Validation for the billing domain: tax rules, Admin discount rules and
 * invoice actions.
 *
 * The cross-field rules (scope versus target product, percentage ceiling,
 * date order) live here rather than only in PostgreSQL, so the API answers with
 * the field that is wrong instead of a CHECK-constraint message naming a column.
 */

export const DISCOUNT_TYPES = ['percentage', 'fixed'] as const;
export const DISCOUNT_SCOPES = ['whole_subscription', 'specific_product'] as const;

export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export const INVOICE_STATUSES = ['Draft', 'Confirmed', 'Paid', 'Cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ACTIONS = ['confirm', 'cancel', 'send', 'print'] as const;
export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

/** A rate is a percentage: two decimals, never above 100, never negative. */
function percentageField(label: string) {
  return z
    .number({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} must be a number.`,
    })
    .finite(`${label} must be a number.`)
    .min(0, `${label} cannot be negative.`)
    .max(100, `${label} cannot exceed 100%.`)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      `${label} can have at most 2 decimal places.`,
    );
}

// ---------------------------------------------------------------------------
// Tax rules
// ---------------------------------------------------------------------------

const taxRuleShape = z
  .object({
    name: textField('Tax rule name', 2, 100),
    rate: percentageField('Tax rate'),
    isActive: booleanField('Active').optional(),
    /** At most one rule may be the default; the service moves the flag. */
    isDefault: booleanField('Default').optional(),
  })
  .strict();

export const createTaxRuleSchema = taxRuleShape;

export const updateTaxRuleSchema = taxRuleShape
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------
// Discount rules
// ---------------------------------------------------------------------------

const discountRuleShape = z
  .object({
    name: textField('Discount name', 3, 255),
    code: z
      .string({ required_error: 'Discount code is required.' })
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9][A-Z0-9_-]{2,49}$/,
        'Discount code must be 3–50 characters using letters, numbers, hyphens or underscores.',
      ),
    discountType: z.enum(DISCOUNT_TYPES, {
      errorMap: () => ({ message: 'Discount type must be percentage or fixed.' }),
    }),
    discountValue: moneyField('Discount value').refine(
      (value) => value > 0,
      'Discount value must be greater than zero.',
    ),
    scope: z.enum(DISCOUNT_SCOPES, {
      errorMap: () => ({
        message: 'Scope must be whole_subscription or specific_product.',
      }),
    }),
    targetProductId: idField('Target product').nullish(),
    minPurchaseAmount: moneyField('Minimum purchase amount').optional(),
    minQuantity: z
      .number({ invalid_type_error: 'Minimum quantity must be a number.' })
      .int('Minimum quantity must be a whole number.')
      .min(0, 'Minimum quantity cannot be negative.')
      .max(10_000, 'Minimum quantity must be 10,000 or less.')
      .optional(),
    startDate: dateField('Start date'),
    endDate: dateField('End date'),
    maxUses: z
      .number({ invalid_type_error: 'Maximum uses must be a number.' })
      .int('Maximum uses must be a whole number.')
      .min(1, 'Maximum uses must be at least 1.')
      .max(1_000_000, 'Maximum uses must be 1,000,000 or less.')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.discountType === 'percentage' && value.discountValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'A percentage discount cannot exceed 100%.',
      });
    }
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be on or after the start date.',
      });
    }
    if (value.scope === 'specific_product' && value.targetProductId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetProductId'],
        message: 'Choose the product this discount applies to.',
      });
    }
    if (value.scope === 'whole_subscription' && value.targetProductId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetProductId'],
        message: 'A whole-subscription discount does not target a single product.',
      });
    }
  });

export const createDiscountRuleSchema = discountRuleShape;

/** Updates are partial; cross-field checks against the stored row run in the service. */
export const updateDiscountRuleSchema = z
  .object({
    name: textField('Discount name', 3, 255).optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9][A-Z0-9_-]{2,49}$/,
        'Discount code must be 3–50 characters using letters, numbers, hyphens or underscores.',
      )
      .optional(),
    discountType: z
      .enum(DISCOUNT_TYPES, {
        errorMap: () => ({ message: 'Discount type must be percentage or fixed.' }),
      })
      .optional(),
    discountValue: moneyField('Discount value')
      .refine((value) => value > 0, 'Discount value must be greater than zero.')
      .optional(),
    scope: z
      .enum(DISCOUNT_SCOPES, {
        errorMap: () => ({
          message: 'Scope must be whole_subscription or specific_product.',
        }),
      })
      .optional(),
    targetProductId: idField('Target product').nullish(),
    minPurchaseAmount: moneyField('Minimum purchase amount').optional(),
    minQuantity: z
      .number({ invalid_type_error: 'Minimum quantity must be a number.' })
      .int('Minimum quantity must be a whole number.')
      .min(0, 'Minimum quantity cannot be negative.')
      .max(10_000, 'Minimum quantity must be 10,000 or less.')
      .optional(),
    startDate: dateField('Start date').optional(),
    endDate: dateField('End date').optional(),
    maxUses: z
      .number({ invalid_type_error: 'Maximum uses must be a number.' })
      .int('Maximum uses must be a whole number.')
      .min(1, 'Maximum uses must be at least 1.')
      .max(1_000_000, 'Maximum uses must be 1,000,000 or less.')
      .optional(),
    isActive: booleanField('Active').optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------
// Invoice actions
// ---------------------------------------------------------------------------

/**
 * Confirm / cancel / send / print all accept an optional note and nothing else.
 * An empty body is valid, so the UI can post `{}` without inventing fields.
 */
export const invoiceActionSchema = z
  .object({
    note: optionalNotes,
  })
  .strict();

export type CreateTaxRuleInput = z.infer<typeof createTaxRuleSchema>;
export type UpdateTaxRuleInput = z.infer<typeof updateTaxRuleSchema>;
export type CreateDiscountRuleInput = z.infer<typeof createDiscountRuleSchema>;
export type UpdateDiscountRuleInput = z.infer<typeof updateDiscountRuleSchema>;
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>;
