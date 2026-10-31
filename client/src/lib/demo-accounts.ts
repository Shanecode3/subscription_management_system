/**
 * Seeded accounts from server/src/db/seed.ts, surfaced on the sign-in screen so
 * an evaluator can switch between roles in one click. These are local demo
 * credentials only and must be removed before any real deployment.
 */
export const DEMO_PASSWORD = 'Brightloop@2026';

export const DEMO_ACCOUNTS = [
  { role: 'ADMIN', label: 'Admin', email: 'admin@brightloop.com' },
  { role: 'STAFF', label: 'Staff', email: 'staff@brightloop.com' },
  { role: 'CUSTOMER', label: 'Customer', email: 'customer@brightloop.com' },
] as const;
