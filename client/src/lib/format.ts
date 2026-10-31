import type { BillingInterval } from './types';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Prices are stored to 2 decimal places, so the UI always shows both. */
export function formatMoney(value: number): string {
  return money.format(Number.isFinite(value) ? value : 0);
}

/**
 * Formats a 'YYYY-MM-DD' calendar date without building a local Date from the
 * string, which would shift the day for anyone west of UTC.
 */
export function formatDate(isoDate: string | null): string {
  if (!isoDate) return 'No end date';

  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

export function billingSuffix(interval: BillingInterval): string {
  return INTERVAL_SUFFIX[interval];
}

/** "Monthly", "Yearly" — used in select options and badges. */
export function intervalLabel(interval: BillingInterval): string {
  return interval.charAt(0).toUpperCase() + interval.slice(1);
}

/**
 * Today as 'YYYY-MM-DD' in the user's own calendar, which is the same shape the
 * API accepts for date fields. Built from local parts rather than toISOString(),
 * which would roll the date over for anyone east of UTC late in the day.
 */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Reads a money input as typed by a person. Returns null for blank or
 * non-numeric text so the caller can show a field-level message instead of
 * sending NaN to the API.
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
