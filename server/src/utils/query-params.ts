import { ValidationError } from './errors';

/**
 * Query-string parsers shared by the invoice and payment ledgers.
 *
 * Express hands every query value over as text, so `?limit=abc` or
 * `?from=31/10/2026` would otherwise reach PostgreSQL and come back as 22P02 or
 * 22007 — messages that name a column instead of the field the user typed.
 * These helpers fail early with the field name the form highlights.
 */

/** A positive integer query value, or undefined when the caller omitted it. */
export function parseOptionalId(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** ISO calendar date ('YYYY-MM-DD'), forwarded to SQL with an explicit cast. */
export function parseDateFilter(raw: unknown, label: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ValidationError(`${label} must be a date in YYYY-MM-DD format.`, [
      { field: label.toLowerCase(), message: 'Use YYYY-MM-DD, for example 2026-10-31.' },
    ]);
  }
  return raw;
}

/** Row cap, bounded so one request cannot ask for the whole ledger. */
export function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new ValidationError('Limit must be a whole number between 1 and 500.', [
      { field: 'limit', message: 'Choose a limit between 1 and 500.' },
    ]);
  }
  return parsed;
}
