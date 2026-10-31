/**
 * Converts a NUMERIC column (which `pg` returns as text to avoid losing
 * precision) into a JSON-safe number rounded to paise/cents.
 *
 * Amounts in this system are bounded by NUMERIC(12,2), well inside the range
 * where an IEEE-754 double represents 2-decimal values exactly, so a number on
 * the wire is safe and far friendlier to the UI than a string. Aggregate
 * totals in later milestones are summed in SQL, never in JavaScript.
 */
export function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}
