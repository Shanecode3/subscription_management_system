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

/** The same states as fills, for stacked bars and their legends. */
export const SUBSCRIPTION_STATUS_COLOR: Record<SubscriptionStatus, string> = {
  Draft: 'bg-slate-400',
  Quotation: 'bg-plum-400',
  Confirmed: 'bg-teal-500',
  Active: 'bg-emerald-500',
  Paused: 'bg-amber-500',
  Closed: 'bg-rose-400',
};

/**
 * The same six colours again, as hex, for SVG strokes that cannot take a class.
 * Each value is the exact step behind the Tailwind class above, so a status
 * reads as one colour in a badge, a bar and a donut alike.
 */
export const SUBSCRIPTION_STATUS_HEX: Record<SubscriptionStatus, string> = {
  Draft: '#94a3b8', // slate-400
  Quotation: '#a06e88', // plum-400
  Confirmed: '#2099a4', // teal-500
  Active: '#10b981', // emerald-500
  Paused: '#f59e0b', // amber-500
  Closed: '#fb7185', // rose-400
};

/** The happy path shown in the progress bar. Paused branches off Active. */export const MAIN_FLOW: readonly SubscriptionStatus[] = [
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
      if (current === 'Active' || current === 'Paused') return 'Close early';
      // A contract that never started is cancelled, not closed — the same
      // transition, but the word the team would actually use for it.
      return 'Cancel contract';
    default:
      return next;
  }
}

/**
 * The override map the customer portal uses. It is the server's
 * `allowedTransitions` reduced to the moves a customer may make, with the
 * customer's own verbs: a quotation is accepted or declined, never "closed".
 * Draft and Confirmed deliberately have no entry — the first is not the
 * customer's to send, and the second is waiting on Brightloop to activate.
 */
const PORTAL_ACTIONS: Partial<
  Record<SubscriptionStatus, Partial<Record<SubscriptionStatus, PortalAction>>>
> = {
  Quotation: { Confirmed: 'accept', Closed: 'decline' },
  Active: { Paused: 'pause', Closed: 'early-close' },
  Paused: { Active: 'resume', Closed: 'early-close' },
  Closed: { Active: 'renew' },
};

export type PortalAction = 'accept' | 'decline' | 'pause' | 'resume' | 'early-close' | 'renew';

export function portalActionFor(
  current: SubscriptionStatus,
  next: SubscriptionStatus,
): PortalAction | null {
  return PORTAL_ACTIONS[current]?.[next] ?? null;
}

export function portalActionLabel(action: PortalAction): string {
  switch (action) {
    case 'accept':
      return 'Accept quotation';
    case 'decline':
      return 'Decline';
    case 'pause':
      return 'Pause subscription';
    case 'resume':
      return 'Resume subscription';
    case 'early-close':
      return 'Close early';
    case 'renew':
      return 'Renew subscription';
  }
}
