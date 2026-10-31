import { ValidationError } from './errors';

/**
 * Reads a `:id` route parameter as a positive integer.
 *
 * Express hands parameters over as text, and PostgreSQL would answer `abc`
 * with a cryptic 22P02. Failing here gives the caller a field-level message
 * that matches the rest of the API's validation errors.
 */
export function parsePositiveIntParam(
  raw: string | string[] | undefined,
  label: string,
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);

  if (value === undefined || value.trim() === '' || !Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${label} must be a positive whole number.`, [
      { field: 'id', message: `${label} must be a positive whole number.` },
    ]);
  }

  return parsed;
}
