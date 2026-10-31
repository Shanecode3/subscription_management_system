import { z } from 'zod';

/**
 * Field builders shared by every domain schema.
 *
 * They exist so a rule such as "money has at most two decimals" is stated once.
 * When the catalog added plans and the subscription module added dates, both
 * domains needed the same bounds — duplicating them is how an API ends up
 * accepting 2026-02-30 on one endpoint and rejecting it on another.
 */

/** NUMERIC(12,2) upper bound, mirrored so the API answers before PostgreSQL does. */
export const MAX_MONEY = 9_999_999_999.99;

export function moneyField(label: string) {
  return z
    .number({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} must be a number.`,
    })
    .finite(`${label} must be a number.`)
    .min(0, `${label} cannot be negative.`)
    .max(MAX_MONEY, `${label} is too large.`)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      `${label} can have at most 2 decimal places.`,
    );
}

export function textField(label: string, min: number, max: number) {
  return z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be ${max} characters or fewer.`);
}

export const optionalNotes = z
  .string()
  .trim()
  .max(2000, 'Notes must be 2000 characters or fewer.')
  .optional();

/** ISO calendar date ('YYYY-MM-DD'). Rejects 2026-02-30, which a regex allows. */
export function dateField(label: string) {
  return z
    .string({ required_error: `${label} is required.` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date in YYYY-MM-DD format.`)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, `${label} is not a real calendar date.`);
}

export const idField = (label: string) =>
  z
    .number({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} must be a number.`,
    })
    .int(`${label} must be a whole number.`)
    .positive(`${label} must be a positive number.`);

export const quantityField = (label: string) =>
  z
    .number({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} must be a number.`,
    })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`)
    .max(10_000, `${label} must be 10,000 or less.`);

export const booleanField = (label: string) =>
  z.boolean({ invalid_type_error: `${label} must be true or false.` });
