import type { PaymentTerms, SubscriptionStatus } from './types';

export type StatusTone = 'neutral' | 'plum' | 'teal' | 'emerald' | 'amber' | 'rose';

/** Kept in step with the server enum so a bad value is never posted. */
export const PAYMENT_TERM_OPTIONS: readonly PaymentTerms[] = [
  'Immediate Payment',
  'Net 15',
  'Net 30',
  'Net 45',
  'Net 60',
];

/**
 * Status colours are one system across the badge, the stepper and the table:
 * a state always reads the same colour wherever it appears.
 */
export const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = {
  Draft: 'neutral',
  Quotation: 'plum',
  Confirmed: 'teal',
  Active: 'emerald',
  Paused: 'amber',
  Closed: 'rose',
};

/** The happy path shown in the progress bar. Paused branches off Active. */
export const MAIN_FLOW: readonly SubscriptionStatus[] = [
  'Draft',
  'Quotation',
  'Confirmed',
  'Active',
  'Closed',
];

/** Position on the progress bar; a paused contract sits on the Active step. */
export function flowIndex(status: SubscriptionStatus): number {
  if (status === 'Paused') return MAIN_FLOW.indexOf('Active');
  return MAIN_FLOW.indexOf(status);
}

/**
 * The label on the button that performs a move. "Renew" and "Resume" both land
 * on Active, so the current state decides which verb the person sees.
 */
export function transitionLabel(
  next: SubscriptionStatus,
  current: SubscriptionStatus,
): string {
  switch (next) {
    case 'Quotation':
      return 'Send quotation';
    case 'Confirmed':
      return 'Confirm quotation';
    case 'Active':
      if (current === 'Closed') return 'Renew';
      if (current === 'Paused') return 'Resume';
      return 'Activate';
    case 'Paused':
      return 'Pause';
    case 'Closed':
      return current === 'Active' || current === 'Paused' ? 'Close early' : 'Close';
    default:
      return next;
  }
}
