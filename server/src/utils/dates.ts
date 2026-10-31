/**
 * Calendar-date helpers shared by billing and the subscription lifecycle.
 *
 * Every DATE in this system is handled as 'YYYY-MM-DD' text — never a JS Date —
 * because `db/pool.ts` parses PostgreSQL DATE columns that way and because a
 * Date built from a calendar string shifts the day in any non-UTC timezone.
 * Arithmetic is done in UTC so month and year lengths are calendar-correct.
 */

/** Today's local calendar date, matching how DATE columns are read back. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Adds whole days to a calendar date without timezone drift. */
export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

/** Payment terms as stored on a contract, reduced to the number of days. */
const PAYMENT_TERM_DAYS: Readonly<Record<string, number>> = {
  'Immediate Payment': 0,
  'Net 15': 15,
  'Net 30': 30,
  'Net 45': 45,
  'Net 60': 60,
};

/**
 * The date an invoice becomes payable. A missing or unknown term falls back to
 * "due on issue", which is the safest default for a billing run.
 */
export function dueDateFor(paymentTerms: string, issueDate = todayIso()): string {
  const days = PAYMENT_TERM_DAYS[paymentTerms] ?? 0;
  return addDaysIso(issueDate, days);
}
