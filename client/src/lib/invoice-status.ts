import type { DiscountStanding, InvoiceAction, InvoiceStatus } from './types';

export type StatusTone = 'neutral' | 'plum' | 'teal' | 'emerald' | 'amber' | 'rose';

/** Invoice states share the palette of the subscription board. */
export const INVOICE_TONE: Record<InvoiceStatus, StatusTone> = {
  Draft: 'neutral',
  Confirmed: 'teal',
  Paid: 'emerald',
  Cancelled: 'rose',
};

export const INVOICE_ACTION_LABEL: Record<InvoiceAction, string> = {
  confirm: 'Confirm invoice',
  send: 'Mark as sent',
  cancel: 'Cancel invoice',
  print: 'Print',
};

/**
 * The same states as fills, for stacked bars and their legends. A status has
 * one colour across the badge, the table and every chart it appears in.
 */
export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  Draft: 'bg-slate-400',
  Confirmed: 'bg-amber-500',
  Paid: 'bg-emerald-500',
  Cancelled: 'bg-rose-400',
};

/**
 * A discount's standing is derived server-side from its window, usage count and
 * active flag, so the label here is never a second opinion on the rules.
 */
export const DISCOUNT_STANDING_TONE: Record<DiscountStanding, StatusTone> = {
  Active: 'emerald',
  Scheduled: 'teal',
  Expired: 'neutral',
  Exhausted: 'amber',
  Inactive: 'neutral',
};
