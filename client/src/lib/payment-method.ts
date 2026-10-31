import type { StatusTone } from './invoice-status';
import type { PaymentMethod } from './types';

/**
 * The four rails from the brief. The order is the order they appear in the
 * payment form, most common first for a software subscription business.
 */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'Bank Transfer',
  'Credit Card',
  'UPI',
  'Cash',
];

/** One colour per rail, so a payment history can be scanned by method. */
export const PAYMENT_METHOD_TONE: Record<PaymentMethod, StatusTone> = {
  'Bank Transfer': 'plum',
  'Credit Card': 'teal',
  UPI: 'emerald',
  Cash: 'amber',
};

/** What the clerk should paste into the note for each rail. */
export const PAYMENT_METHOD_HINT: Record<PaymentMethod, string> = {
  'Bank Transfer': 'Add the bank reference so finance can match the statement line.',
  'Credit Card': 'Add the processor receipt id.',
  UPI: 'Add the UPI transaction id.',
  Cash: 'Add the receipt number handed to the customer.',
};
