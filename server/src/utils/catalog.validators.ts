import { z } from 'zod';
import {
  booleanField,
  dateField,
  idField,
  moneyField,
  optionalNotes,
  quantityField,
  textField,
} from './zod-fields';

/**
 * Validation for the catalog domain: products, their variants, subscription
 * plans and quotation templates.
 *
 * Every schema is `.strict()`, so an unexpected key (for example a client
 * trying to set `isActive` on create, or `id`) is rejected with a clear message
 * instead of being silently dropped.
 */

export const PRODUCT_TYPES = ['Software', 'Service', 'Add-on'] as const;
export const BILLING_INTERVALS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// ---------------------------------------------------------------------------
// Products and variants
// ---------------------------------------------------------------------------

const productShape = z
  .object({
    name: textField('Product name', 2, 255),
    type: z.enum(PRODUCT_TYPES, {
      errorMap: () => ({ message: 'Product type must be Software, Service or Add-on.' }),
    }),
    salesPrice: moneyField('Sales price'),
    costPrice: moneyField('Cost price').optional(),
    notes: optionalNotes,
  })
  .strict();

export const createProductSchema = productShape;

/**
 * `isActive` is settable only through an update: new products are always
 * created active, and the flag is what restores a retired item.
 */
export const updateProductSchema = productShape
  .extend({
    isActive: booleanField('Active').optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const createVariantSchema = z
  .object({
    attributeName: textField('Attribute name', 1, 100),
    attributeValue: textField('Attribute value', 1, 100),
    priceExtra: moneyField('Price extra'),
    sku: z.string().trim().max(100, 'SKU must be 100 characters or fewer.').optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Subscription plans
// ---------------------------------------------------------------------------

const planShape = z
  .object({
    name: textField('Plan name', 2, 255),
    price: moneyField('Plan price'),
    billingInterval: z.enum(BILLING_INTERVALS, {
      errorMap: () => ({
        message: 'Billing interval must be one of: daily, weekly, monthly, yearly.',
      }),
    }),
    minQuantity: z
      .number({ invalid_type_error: 'Minimum quantity must be a number.' })
      .int('Minimum quantity must be a whole number.')
      .min(1, 'Minimum quantity must be at least 1.')
      .max(10_000, 'Minimum quantity must be 10,000 or less.')
      .optional(),
    availableFrom: dateField('Available from'),
    availableTo: dateField('Available to').nullish(),
    autoClose: booleanField('Auto close').optional(),
    allowEarlyClose: booleanField('Allow early close').optional(),
    allowPause: booleanField('Allow pause').optional(),
    allowRenew: booleanField('Allow renew').optional(),
  })
  .strict();

export const createPlanSchema = planShape.superRefine((value, ctx) => {
  if (value.availableTo && value.availableTo < value.availableFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['availableTo'],
      message: 'Available-to date must be on or after the available-from date.',
    });
  }
});

/** Cross-field date checks for updates run in the service, where the stored row is known. */
export const updatePlanSchema = planShape
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------
// Quotation templates
// ---------------------------------------------------------------------------

export const createTemplateSchema = z
  .object({
    name: textField('Template name', 2, 255),
    planId: idField('Plan'),
    validityDays: z
      .number({ required_error: 'Validity days is required.' })
      .int('Validity days must be a whole number.')
      .min(1, 'Validity days must be at least 1.')
      .max(3650, 'Validity days must be 3,650 or less.'),
    notes: optionalNotes,
    lines: z
      .array(
        z
          .object({
            productId: idField('Product'),
            variantId: idField('Variant').nullish(),
            quantity: quantityField('Quantity'),
            unitPrice: moneyField('Unit price').optional(),
          })
          .strict(),
      )
      .min(1, 'Add at least one product line to the template.')
      .max(50, 'A template can contain at most 50 product lines.'),
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type TemplateLineInput = CreateTemplateInput['lines'][number];
