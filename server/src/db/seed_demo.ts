import { closePool, pool } from './pool';
import { logger } from '../utils/logger';
import { seedCatalogue } from './seed';
import { signup } from '../services/auth.service';
import * as subscriptionService from '../services/subscription.service';
import * as invoiceService from '../services/invoice.service';
import * as paymentService from '../services/payment.service';
import * as discountService from '../services/discount.service';
import { runBillingDay } from '../services/billing.engine';
import type { Requester } from '../services/requester';
import type { PaymentMethod } from '../utils/payment.validators';
import type { SubscriptionStatus } from '../utils/subscription.validators';

/**
 * The dataset the demo video runs on.
 *
 * Every contract, invoice and payment below is created through the same service
 * functions the API calls, so the seeded rows obey the state machine, the plan
 * flags, the tax engine and the discount engine exactly as a user's would. The
 * only SQL the script writes by hand does two things a person cannot ask the UI
 * for: it sets a contract's `next_billing_date` back to its historical start so
 * the real billing run can generate its past cycles, and it backdates those
 * invoices to the cycle they were billed for.
 *
 * Run with `npm run db:demo`. It clears the database first.
 */

const DEMO_PASSWORD = 'Brightloop@2026';
const TODAY = todayIso();

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

const TERMS_DAYS: Record<string, number> = {
  'Immediate Payment': 0,
  'Net 15': 15,
  'Net 30': 30,
  'Net 45': 45,
  'Net 60': 60,
};

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function resetDatabase(): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      payments, invoice_lines, invoices, subscription_lines, audit_logs,
      subscriptions, quotation_template_lines, quotation_templates,
      discount_rules, tax_rules, subscription_plans, product_variants, products, users
    RESTART IDENTITY CASCADE
  `);
  logger.info('Database cleared for the demo seed.');
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

async function idByName(table: string, name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM ${table} WHERE name = $1`,
    [name],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Seed lookup failed: no ${table} named "${name}".`);
  return id;
}

async function productWithVariant(productName: string, brand: string): Promise<{
  productId: number;
  variantId: number;
}> {
  const { rows } = await pool.query<{ product_id: number; variant_id: number }>(
    `SELECT p.id AS product_id, v.id AS variant_id
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
      WHERE p.name = $1 AND v.attribute_value = $2`,
    [productName, brand],
  );
  const row = rows[0];
  if (!row) throw new Error(`Seed lookup failed: ${productName} / ${brand}.`);
  return { productId: row.product_id, variantId: row.variant_id };
}

async function customerId(email: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE email = $1 AND role = 'CUSTOMER'`,
    [email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Seed lookup failed: no customer ${email}.`);
  return id;
}

// ---------------------------------------------------------------------------
// Contract helpers
// ---------------------------------------------------------------------------

let admin: Requester;

async function transition(
  id: number,
  status: SubscriptionStatus,
  reason?: string,
): Promise<void> {
  await subscriptionService.transitionStatus(id, { status, reason }, admin);
}

/** Draft -> Quotation -> Confirmed, the path a staff member takes. */
async function sendQuotation(id: number): Promise<void> {
  await transition(id, 'Quotation');
  await transition(id, 'Confirmed');
}

type SeedInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

function cycleDate(startIso: string, interval: SeedInterval, index: number): string {
  switch (interval) {
    case 'daily':
      return addDays(startIso, index);
    case 'weekly':
      return addDays(startIso, index * 7);
    case 'monthly':
      return addMonths(startIso, index);
    case 'yearly':
      return addMonths(startIso, index * 12);
  }
}

/**
 * Puts the contract back onto its historical billing cycle, then lets the real
 * billing run generate one invoice per cycle. Nothing here writes an invoice by
 * hand: tax, discounts, numbering and the cycle key all come from the engine.
 *
 * `advanceBillingCycle` deliberately jumps a late contract forward to today
 * instead of billing every missed month, so the schedule field is set to the
 * cycle being billed before each run — the date the contract would have held if
 * it had been running all along.
 */
async function billHistory(
  subscriptionId: number,
  startDate: string,
  interval: SeedInterval,
  cycles: number,
): Promise<number> {
  await pool.query(
    `UPDATE subscriptions SET activated_at = $2::timestamptz
      WHERE id = $1 AND activated_at IS NULL`,
    [subscriptionId, startDate],
  );

  let billed = 0;
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await pool.query(`UPDATE subscriptions SET next_billing_date = $2::date WHERE id = $1`, [
      subscriptionId,
      cycleDate(startDate, interval, cycle),
    ]);

    const run = await runBillingDay(admin);
    if (run.failedCount > 0) {
      const failure = run.failures[0];
      throw new Error(`Billing failed while seeding: ${failure?.message ?? 'unknown'}`);
    }
    if (!run.invoices.some((invoice) => invoice.subscriptionId === subscriptionId)) break;
    billed += 1;
  }
  return billed;
}

interface SeedInvoice {
  id: number;
  invoiceNumber: string;
  status: string;
  billingCycleDate: string;
  issueDate: string;
  totalAmount: number;
}

async function invoicesFor(subscriptionId: number): Promise<SeedInvoice[]> {
  const { rows } = await pool.query<{
    id: number;
    invoice_number: string;
    status: string;
    billing_cycle_date: string;
    issue_date: string;
    total_amount: string;
  }>(
    `SELECT id, invoice_number, status,
            to_char(billing_cycle_date, 'YYYY-MM-DD') AS billing_cycle_date,
            to_char(issue_date, 'YYYY-MM-DD') AS issue_date,
            total_amount::text
       FROM invoices
      WHERE subscription_id = $1
      ORDER BY billing_cycle_date ASC`,
    [subscriptionId],
  );
  return rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    billingCycleDate: row.billing_cycle_date,
    issueDate: row.issue_date,
    totalAmount: Number(row.total_amount),
  }));
}

/**
 * A generated invoice is issued today, which would make every past cycle look
 * like it was billed this morning. Re-dating it to its own cycle gives the
 * ledger the shape a customer would actually see.
 */
async function redateInvoices(subscriptionId: number, paymentTerms: string): Promise<void> {
  await pool.query(
    `UPDATE invoices
        SET issue_date = billing_cycle_date,
            due_date = billing_cycle_date + $2::int
      WHERE subscription_id = $1`,
    [subscriptionId, TERMS_DAYS[paymentTerms] ?? 0],
  );
}

async function confirmInvoice(id: number): Promise<void> {
  await invoiceService.performInvoiceAction(id, 'confirm', admin);
}

async function payInvoice(
  invoice: SeedInvoice,
  method: PaymentMethod,
  fraction: number,
  note: string,
): Promise<void> {
  const amount = Math.round(invoice.totalAmount * fraction * 100) / 100;
  if (amount <= 0) return;
  // Settle a couple of days after issue, never later than today.
  const preferred = addDays(invoice.issueDate, 3);
  const date = preferred > TODAY ? TODAY : preferred;
  await paymentService.recordPayment(
    { invoiceId: invoice.id, amount, method, date, note },
    admin,
  );
}

// ---------------------------------------------------------------------------
// The dataset
// ---------------------------------------------------------------------------

interface CustomerSeed {
  name: string;
  email: string;
  companyName: string;
  phone: string;
  address: string;
}

const CUSTOMERS: CustomerSeed[] = [
  {
    name: 'Vikram Rao',
    email: 'vikram.rao@raologistics.example',
    companyName: 'Rao Logistics',
    phone: '+91 98200 22001',
    address: 'Plot 12, MIDC Industrial Area, Pune 411019',
  },
  {
    name: 'Meera Iyer',
    email: 'meera.iyer@iyeranalytics.example',
    companyName: 'Iyer Analytics',
    phone: '+91 98200 22002',
    address: '4th Floor, Prestige Tech Park, Bengaluru 560103',
  },
  {
    name: 'Kabir Khan',
    email: 'kabir.khan@khanandco.example',
    companyName: 'Khan & Co',
    phone: '+91 98200 22003',
    address: '22 Park Street, Kolkata 700016',
  },
];

async function seedCustomers(): Promise<void> {
  for (const customer of CUSTOMERS) {
    await signup({ ...customer, password: DEMO_PASSWORD });
  }
}

async function seedDiscountCatalogue(): Promise<void> {
  const supportId = await idByName('products', 'Priority Support 24/7');

  await discountService.createDiscountRule(
    {
      name: 'Black Friday 2026 — 15% off any subscription',
      code: 'BLACKFRIDAY15',
      discountType: 'percentage',
      discountValue: 15,
      scope: 'whole_subscription',
      minPurchaseAmount: 0,
      minQuantity: 0,
      startDate: addDays(TODAY, -1),
      endDate: addDays(TODAY, 45),
      maxUses: 200,
    },
    admin,
  );

  await discountService.createDiscountRule(
    {
      name: 'Spring launch — USD 50 off an annual rollout',
      code: 'SPRING50',
      discountType: 'fixed',
      discountValue: 50,
      scope: 'whole_subscription',
      minPurchaseAmount: 1000,
      minQuantity: 5,
      startDate: '2026-03-01',
      endDate: '2026-06-30',
      maxUses: 100,
    },
    admin,
  );

  await discountService.createDiscountRule(
    {
      name: 'Launch week — 20% off Priority Support',
      code: 'LAUNCH20',
      discountType: 'percentage',
      discountValue: 20,
      scope: 'specific_product',
      targetProductId: supportId,
      minPurchaseAmount: 0,
      minQuantity: 1,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      maxUses: 5,
    },
    admin,
  );

  // Five historical invoices took this rule to its cap; the counter is what the
  // billing engine would have written, and the CHECK keeps it within max_uses.
  await pool.query(`UPDATE discount_rules SET current_uses = 5 WHERE code = 'LAUNCH20'`);
}

/**
 * Priya Nair is the account the evaluator signs in as, so her three contracts
 * show a paying customer with history, an overdue invoice, a live quotation and
 * a draft the team is still preparing.
 */
async function seedPriya(): Promise<void> {
  const priya = await customerId('customer@brightloop.com');
  const monthlyTemplate = await idByName('quotation_templates', 'Enterprise Monthly Starter');
  const annualTemplate = await idByName('quotation_templates', 'Annual Enterprise Rollout');
  const supportTemplate = await idByName('quotation_templates', 'Support Renewal Bundle');

  // 1. Monthly contract, three cycles of history, the latest one overdue.
  const monthly = await subscriptionService.createSubscription(
    {
      customerId: priya,
      templateId: monthlyTemplate,
      startDate: '2026-08-15',
      expiryDate: '2027-08-14',
      paymentTerms: 'Net 15',
      notes: 'Runs the Odoo-branded ERP licence across the two retail locations.',
    },
    admin,
  );
  await sendQuotation(monthly.id);
  await transition(monthly.id, 'Active');
  await billHistory(monthly.id, '2026-08-15', 'monthly', 3);
  await redateInvoices(monthly.id, 'Net 15');

  const monthlyInvoices = await invoicesFor(monthly.id);
  await confirmInvoice(monthlyInvoices[0]!.id);
  await payInvoice(monthlyInvoices[0]!, 'UPI', 1, 'UPI settlement · August cycle');
  await confirmInvoice(monthlyInvoices[1]!.id);
  await payInvoice(monthlyInvoices[1]!, 'Bank Transfer', 1, 'NEFT · September cycle');
  await confirmInvoice(monthlyInvoices[2]!.id);
  await invoiceService.performInvoiceAction(monthlyInvoices[2]!.id, 'send', admin);

  // 2. Annual contract that has been running since February and is fully paid.
  const annual = await subscriptionService.createSubscription(
    {
      customerId: priya,
      templateId: annualTemplate,
      startDate: '2026-02-01',
      expiryDate: '2027-01-31',
      paymentTerms: 'Net 30',
      notes: 'Annual rollout agreed at the February review.',
    },
    admin,
  );
  await sendQuotation(annual.id);
  await transition(annual.id, 'Active');
  await billHistory(annual.id, '2026-02-01', 'yearly', 1);
  await redateInvoices(annual.id, 'Net 30');
  const annualInvoices = await invoicesFor(annual.id);
  await confirmInvoice(annualInvoices[0]!.id);
  await payInvoice(annualInvoices[0]!, 'Credit Card', 1, 'Card payment · annual licence');

  // 3. A quotation waiting on the customer, for the accept / decline demo.
  const quotation = await subscriptionService.createSubscription(
    {
      customerId: priya,
      templateId: monthlyTemplate,
      startDate: addDays(TODAY, 1),
      expiryDate: addMonths(addDays(TODAY, 1), 3),
      paymentTerms: 'Net 15',
      notes: 'November renewal quote — accept from your portal to start the contract.',
    },
    admin,
  );
  await transition(quotation.id, 'Quotation');

  // 4. A draft the team is still putting together.
  const draft = await subscriptionService.createSubscription(
    {
      customerId: priya,
      templateId: supportTemplate,
      startDate: addDays(TODAY, 10),
      expiryDate: addMonths(addDays(TODAY, 10), 12),
      paymentTerms: 'Net 30',
      notes: 'Support retainer renewal, priced once the October incidents close.',
    },
    admin,
  );
  logger.info(`Priya: contracts ${monthly.subscriptionNumber}, ${annual.subscriptionNumber}, ${quotation.subscriptionNumber}, ${draft.subscriptionNumber}`);
}

/** Vikram runs a weekly contract with six cycles: four paid, one open, one cancelled. */
async function seedVikram(): Promise<void> {
  const vikram = await customerId('vikram.rao@raologistics.example');
  const supportId = await idByName('products', 'Priority Support 24/7');

  const weekly = await subscriptionService.createSubscription(
    {
      customerId: vikram,
      planId: await idByName('subscription_plans', 'Weekly Growth'),
      startDate: '2026-09-21',
      expiryDate: '2027-09-20',
      paymentTerms: 'Net 15',
      notes: 'Weekly support retainer for the dispatch floor.',
      lines: [{ productId: supportId, quantity: 2 }],
    },
    admin,
  );
  await sendQuotation(weekly.id);
  await transition(weekly.id, 'Active');
  await billHistory(weekly.id, '2026-09-21', 'weekly', 6);
  await redateInvoices(weekly.id, 'Net 15');

  const invoices = await invoicesFor(weekly.id);
  const methods: PaymentMethod[] = ['Bank Transfer', 'UPI', 'Bank Transfer', 'Cash'];
  for (let index = 0; index < 4; index += 1) {
    const invoice = invoices[index]!;
    await confirmInvoice(invoice.id);
    await payInvoice(invoice, methods[index]!, 1, `Weekly support · cycle ${invoice.billingCycleDate}`);
  }

  // The most recent cycle is confirmed and still inside its terms.
  await confirmInvoice(invoices[4]!.id);

  // One cycle was raised in error and cancelled before the customer saw it.
  await invoiceService.performInvoiceAction(
    invoices[5]!.id,
    'cancel',
    admin,
    'Raised against the wrong contract — reissued under the correct one.',
  );

  logger.info(`Vikram: weekly contract ${weekly.subscriptionNumber} with ${invoices.length} invoices`);
}

/** Meera has a paused monthly contract and an annual one the customer just accepted. */
async function seedMeera(): Promise<void> {
  const meera = await customerId('meera.iyer@iyeranalytics.example');
  const erp = await productWithVariant('Brightloop Enterprise ERP', 'Brightloop');
  const addonId = await idByName('products', 'Cloud Infrastructure Add-on');
  const annualTemplate = await idByName('quotation_templates', 'Annual Enterprise Rollout');

  const monthly = await subscriptionService.createSubscription(
    {
      customerId: meera,
      planId: await idByName('subscription_plans', 'Monthly Pro'),
      startDate: '2026-07-20',
      expiryDate: '2027-07-19',
      paymentTerms: 'Immediate Payment',
      notes: 'Paused while the analytics migration is on hold.',
      lines: [
        { productId: erp.productId, variantId: erp.variantId, quantity: 1 },
        { productId: addonId, quantity: 1 },
      ],
    },
    admin,
  );
  await sendQuotation(monthly.id);
  await transition(monthly.id, 'Active');
  await billHistory(monthly.id, '2026-07-20', 'monthly', 3);
  await redateInvoices(monthly.id, 'Immediate Payment');

  const invoices = await invoicesFor(monthly.id);
  for (const invoice of invoices) {
    await confirmInvoice(invoice.id);
    await payInvoice(invoice, 'UPI', 1, `Monthly pro · cycle ${invoice.billingCycleDate}`);
  }

  await transition(monthly.id, 'Paused', 'Customer asked to pause billing during an internal migration.');

  // Annual contract accepted from the portal, waiting on its start date.
  const annual = await subscriptionService.createSubscription(
    {
      customerId: meera,
      templateId: annualTemplate,
      startDate: addDays(TODAY, 5),
      expiryDate: addDays(addMonths(addDays(TODAY, 5), 12), -1),
      paymentTerms: 'Net 30',
      notes: 'Accepted in the portal; starts on the November wave.',
    },
    admin,
  );
  await transition(annual.id, 'Quotation');
  await subscriptionService.acceptQuotation(
    annual.id,
    { id: meera, role: 'CUSTOMER' },
    'Accepted in the customer portal.',
  );

  logger.info(`Meera: paused ${monthly.subscriptionNumber}, accepted ${annual.subscriptionNumber}`);
}

/** Kabir has a contract he closed early and a daily trial that bills today. */
async function seedKabir(): Promise<void> {
  const kabir = await customerId('kabir.khan@khanandco.example');
  const erpOdoo = await productWithVariant('Brightloop Enterprise ERP', 'Odoo');
  const addonId = await idByName('products', 'Cloud Infrastructure Add-on');

  const closed = await subscriptionService.createSubscription(
    {
      customerId: kabir,
      planId: await idByName('subscription_plans', 'Monthly Pro'),
      startDate: '2026-06-01',
      expiryDate: '2027-05-31',
      paymentTerms: 'Net 30',
      notes: 'Closed early when the retail rollout moved to an in-house platform.',
      lines: [{ productId: erpOdoo.productId, variantId: erpOdoo.variantId, quantity: 1 }],
    },
    admin,
  );
  await sendQuotation(closed.id);
  await transition(closed.id, 'Active');
  await billHistory(closed.id, '2026-06-01', 'monthly', 3);
  await redateInvoices(closed.id, 'Net 30');

  for (const invoice of await invoicesFor(closed.id)) {
    await confirmInvoice(invoice.id);
    await payInvoice(invoice, 'Credit Card', 1, `Monthly pro · cycle ${invoice.billingCycleDate}`);
  }

  await transition(closed.id, 'Closed', 'Customer requested early closure.');
  // The closure happened mid-September, not at seeding time.
  await pool.query(`UPDATE subscriptions SET closed_at = '2026-09-15T10:30:00+05:30' WHERE id = $1`, [
    closed.id,
  ]);

  // A daily trial whose next cycle is due today: the evaluator can press
  // "Run billing day" on camera and watch a real invoice appear.
  const daily = await subscriptionService.createSubscription(
    {
      customerId: kabir,
      planId: await idByName('subscription_plans', 'Flexible Daily Trial'),
      startDate: TODAY,
      expiryDate: addDays(TODAY, 30),
      paymentTerms: 'Immediate Payment',
      notes: 'Trial of the managed hosting add-on before a wider rollout.',
      lines: [
        { productId: await idByName('products', 'Priority Support 24/7'), quantity: 1 },
        { productId: addonId, quantity: 1 },
      ],
    },
    admin,
  );
  await sendQuotation(daily.id);
  await transition(daily.id, 'Active');

  logger.info(`Kabir: closed ${closed.subscriptionNumber}, trial ${daily.subscriptionNumber} due today`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await resetDatabase();
  await seedCatalogue();

  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE email = 'admin@brightloop.com'`,
  );
  const adminId = rows[0]?.id;
  if (adminId === undefined) throw new Error('The admin account was not seeded.');
  admin = { id: adminId, role: 'ADMIN' };

  // History is billed with the welcome rules switched off, so the demo starts
  // with both counters at zero and the evaluator sees them fire live.
  await pool.query(`UPDATE discount_rules SET is_active = FALSE WHERE code IN ('WELCOME10', 'SUPPORT25')`);

  await seedCustomers();

  await seedPriya();
  await seedVikram();
  await seedMeera();
  await seedKabir();

  await pool.query(`UPDATE discount_rules SET is_active = TRUE WHERE code IN ('WELCOME10', 'SUPPORT25')`);
  await seedDiscountCatalogue();

  const summary = await pool.query<{
    customers: string;
    contracts: string;
    invoices: string;
    payments: string;
    collected: string;
    outstanding: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM users WHERE role = 'CUSTOMER')                     AS customers,
      (SELECT COUNT(*)::text FROM subscriptions)                                     AS contracts,
      (SELECT COUNT(*)::text FROM invoices)                                          AS invoices,
      (SELECT COUNT(*)::text FROM payments)                                          AS payments,
      (SELECT COALESCE(SUM(amount), 0)::text FROM payments)                          AS collected,
      (SELECT COALESCE(SUM(total_amount - amount_paid), 0)::text
         FROM invoices WHERE status IN ('Draft', 'Confirmed'))                       AS outstanding
  `);
  const row = summary.rows[0]!;

  const byStatus = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM subscriptions GROUP BY status ORDER BY status`,
  );

  console.log('');
  console.log('Demo data ready (password for every account): ' + DEMO_PASSWORD);
  console.log(`  Customers:  ${row.customers}`);
  console.log(`  Contracts:  ${row.contracts}  [${byStatus.rows.map((r) => `${r.status} ${r.count}`).join(', ')}]`);
  console.log(`  Invoices:   ${row.invoices}`);
  console.log(`  Payments:   ${row.payments}  (USD ${row.collected} collected)`);
  console.log(`  Owed:       USD ${row.outstanding} across open invoices`);
  console.log('');
}

main()
  .catch((error: unknown) => {
    logger.error('Demo seeding failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
