import bcrypt from 'bcryptjs';
import type { PoolClient, QueryResultRow } from 'pg';
import { performance } from 'node:perf_hooks';
import { closePool, pool, withTransaction } from './pool';
import * as financeRepository from '../repositories/finance.repository';
import { logger } from '../utils/logger';

/**
 * Performance dataset for the Finance Lead dashboard.
 *
 * The brief requires every screen to answer in under two seconds with
 * thousands of subscriptions, so this script builds a realistic volume of
 * contracts, invoices and receipts — then measures the dashboard aggregates
 * with EXPLAIN ANALYZE so the claim is evidenced, not assumed.
 *
 * It is deterministic: the same seed produces the same dataset, so a timing
 * recorded in DEFENSE_LOG.md can be reproduced by the evaluator. It is also
 * re-runnable: a second run refuses to duplicate data unless `--reset` is
 * passed, which deletes only the rows tagged with the perf email domain.
 *
 * Usage: npm run db:seed:perf [-- --reset]
 */

const PERF_EMAIL_DOMAIN = '@brightloop.test';
const PERF_EMAIL_PREFIX = 'perf.customer';
const PERF_PASSWORD = 'Brightloop@2026';

const CUSTOMER_COUNT = 140;
const SUBSCRIPTION_COUNT = 1_050;
const INVOICE_COUNT = 2_700;
const BATCH_SIZE = 250;

const RESET = process.argv.includes('--reset');

// ---------------------------------------------------------------------------
// Deterministic randomness — a fixed seed makes every timing reproducible
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = mulberry32(20_261_031);

function randomInt(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Calendar helpers — every date stays a 'YYYY-MM-DD' string end to end, the
// same representation the pool's DATE parser produces at runtime.
// ---------------------------------------------------------------------------

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function isoDate(offsetDays: number): string {
  const date = utcToday();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timestampFor(iso: string): string {
  return `${iso}T09:00:00Z`;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

type ColumnKind = 'value' | 'date';

function buildTuples(rowCount: number, kinds: ColumnKind[]): string {
  const tuples: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const base = row * kinds.length;
    const placeholders = kinds.map(
      (kind, column) => `$${base + column + 1}${kind === 'date' ? '::date' : ''}`,
    );
    tuples.push(`(${placeholders.join(', ')})`);
  }
  return tuples.join(', ');
}

/** Chunks a value matrix so one statement never exceeds PostgreSQL's parameter cap. */
function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    result.push(items.slice(index, index + BATCH_SIZE));
  }
  return result;
}

async function insertCustomers(client: PoolClient, passwordHash: string): Promise<number[]> {
  const rows = Array.from({ length: CUSTOMER_COUNT }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    return [
      `Perf Customer ${number}`,
      `${PERF_EMAIL_PREFIX}${number}${PERF_EMAIL_DOMAIN}`,
      passwordHash,
      'CUSTOMER',
      `+91 90000 ${number}`,
      `Perf Holdings ${number}`,
      `${randomInt(1, 200)} Residency Road, Bengaluru`,
    ];
  });

  const ids: number[] = [];
  for (const batch of batches(rows)) {
    const result = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, phone, company_name, address)
       VALUES ${buildTuples(batch.length, ['value', 'value', 'value', 'value', 'value', 'value', 'value'])}
       RETURNING id`,
      batch.flat(),
    );
    ids.push(...result.rows.map((row) => row.id));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Dataset shapes
// ---------------------------------------------------------------------------

interface PlanSeed {
  id: number;
  interval: string;
}

interface ProductSeed {
  id: number;
  name: string;
  price: number;
  isAddon: boolean;
}

interface SubscriptionSeed {
  number: string;
  customerId: number;
  planId: number;
  status: string;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  paymentTerms: string;
  periodAmount: number;
  lines: LineSeed[];
}

interface LineSeed {
  productId: number;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  isAddon: boolean;
  isAddonActive: boolean;
}

interface InvoiceSeed {
  subscriptionNumber: string;
  customerId: number;
  billingCycleDate: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  totalAmount: number;
  amountPaid: number;
}

interface PaymentSeed {
  invoiceNumber: string;
  customerId: number;
  amount: number;
  method: string;
  date: string;
}

const SUBSCRIPTION_STATUS_WEIGHTS = [
  ['Active', 66],
  ['Confirmed', 12],
  ['Paused', 8],
  ['Closed', 8],
  ['Draft', 6],
] as const;

const PAYMENT_METHODS = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash'] as const;

function buildSubscriptions(
  customerIds: number[],
  plans: PlanSeed[],
  products: ProductSeed[],
): SubscriptionSeed[] {
  const planPool: PlanSeed[] = [];
  for (const plan of plans) {
    // Monthly is the dominant cadence in a SaaS book of business; the other
    // intervals stay well represented so the MRR multipliers are exercised.
    const weight = plan.interval === 'monthly' ? 5 : plan.interval === 'yearly' ? 3 : 1;
    for (let copy = 0; copy < weight; copy += 1) planPool.push(plan);
  }

  const baseProducts = products.filter((product) => !product.isAddon);
  const addonProducts = products.filter((product) => product.isAddon);

  const subscriptions: SubscriptionSeed[] = [];

  for (let index = 0; index < SUBSCRIPTION_COUNT; index += 1) {
    const number = `SUB-2026-9${String(index + 1).padStart(5, '0')}`;
    const plan = pick(planPool);
    const status = weighted(SUBSCRIPTION_STATUS_WEIGHTS);
    const startOffset = -randomInt(5, 540);
    const startDate = isoDate(startOffset);

    const lines: LineSeed[] = [];

    const baseProduct = pick(baseProducts);
    const baseQuantity = randomInt(1, 4);
    const basePrice = baseProduct.price;
    lines.push({
      productId: baseProduct.id,
      description: `${baseProduct.name} — seat licence`,
      quantity: baseQuantity,
      unitPrice: basePrice,
      subtotal: round2(baseQuantity * basePrice),
      isAddon: false,
      isAddonActive: true,
    });

    const addonCount = addonProducts.length > 0 ? randomInt(0, 2) : 0;
    for (let addon = 0; addon < addonCount; addon += 1) {
      const addonProduct = pick(addonProducts);
      const quantity = randomInt(1, 2);
      lines.push({
        productId: addonProduct.id,
        description: `${addonProduct.name} add-on`,
        quantity,
        unitPrice: addonProduct.price,
        subtotal: round2(quantity * addonProduct.price),
        isAddon: true,
        isAddonActive: random() < 0.72,
      });
    }

    const periodAmount = round2(
      lines
        .filter((line) => !line.isAddon || line.isAddonActive)
        .reduce((sum, line) => sum + line.subtotal, 0),
    );

    const isLive = status === 'Active' || status === 'Paused';
    const expiryDate = isLive ? addDays(startDate, 365) : addDays(startDate, randomInt(120, 540));

    // Roughly half of the active book falls due inside the next month, which
    // gives the Billing Day screen something real to process.
    const nextBillingDate =
      status === 'Active' ? isoDate(random() < 0.45 ? -randomInt(0, 25) : randomInt(1, 30)) : null;

    subscriptions.push({
      number,
      customerId: customerIds[index % customerIds.length]!,
      planId: plan.id,
      status,
      startDate,
      expiryDate,
      nextBillingDate,
      // Only terms the contract screen and due-date map understand — an
      // unknown term silently fell back to "due today".
      paymentTerms: pick(['Immediate Payment', 'Net 15', 'Net 30', 'Net 45']),
      periodAmount,
      lines,
    });
  }

  return subscriptions;
}

function buildInvoices(subscriptions: SubscriptionSeed[], taxRate: number): InvoiceSeed[] {
  const eligible = subscriptions.filter((subscription) => subscription.status !== 'Draft');
  const invoices: InvoiceSeed[] = [];
  const usedCycleDates = new Map<string, Set<string>>();

  for (let index = 0; index < INVOICE_COUNT; index += 1) {
    const subscription = eligible[index % eligible.length]!;

    const status = weighted([
      ['Paid', 45],
      ['Confirmed', 38],
      ['Draft', 10],
      ['Cancelled', 7],
    ] as const);

    // `UNIQUE(subscription_id, billing_cycle_date)` forbids billing one contract
    // twice for the same cycle, so a subscription's seeded invoices must land on
    // distinct dates. Random dates collide often enough at this volume, so a
    // taken date steps back a day until it is free.
    const taken = usedCycleDates.get(subscription.number) ?? new Set<string>();
    let issueOffset = -randomInt(1, 365);
    let issueDate = isoDate(issueOffset);
    while (taken.has(issueDate)) {
      issueOffset -= 1;
      issueDate = isoDate(issueOffset);
    }
    taken.add(issueDate);
    usedCycleDates.set(subscription.number, taken);

    const dueDate = addDays(issueDate, pick([0, 7, 15, 30]));

    const subtotal = subscription.periodAmount;
    const taxTotal = round2((subtotal * taxRate) / 100);
    const totalAmount = round2(subtotal + taxTotal);

    let amountPaid = 0;
    if (status === 'Paid') {
      amountPaid = totalAmount;
    } else if (status === 'Confirmed' && random() < 0.3) {
      // Part-payment: the invoice is still Confirmed with a real balance, so it
      // appears in the outstanding KPI rather than looking settled.
      amountPaid = round2(totalAmount * (0.3 + random() * 0.4));
    }

    invoices.push({
      subscriptionNumber: subscription.number,
      customerId: subscription.customerId,
      billingCycleDate: issueDate,
      invoiceNumber: `INV-2026-9${String(index + 1).padStart(5, '0')}`,
      status,
      issueDate,
      dueDate,
      subtotal,
      taxTotal,
      totalAmount,
      amountPaid,
    });
  }

  return invoices;
}

/**
 * A receipt ledger that reconciles with every invoice: the payments written for
 * an invoice sum exactly to its amount_paid, so the dashboard's collected total
 * and the invoice balances can never disagree.
 */
function buildPayments(invoices: InvoiceSeed[]): PaymentSeed[] {
  const payments: PaymentSeed[] = [];
  const todayIso = isoDate(0);

  for (const invoice of invoices) {
    if (invoice.amountPaid <= 0) continue;

    const maxOffset = Math.max(
      0,
      Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${invoice.issueDate}T00:00:00Z`)) / 86_400_000),
    );
    const payOffset = randomInt(0, maxOffset);
    const payDate = addDays(invoice.issueDate, payOffset);

    // A balance too small to split stays a single receipt: payments.amount has a
    // CHECK (amount > 0), so a 0.00 half-row would abort the whole seed.
    if (random() < 0.8 || invoice.amountPaid < 0.05) {
      payments.push({
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        amount: invoice.amountPaid,
        method: pick(PAYMENT_METHODS),
        date: payDate,
      });
    } else {
      const first = round2(invoice.amountPaid * 0.6);
      const second = round2(invoice.amountPaid - first);
      payments.push({
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        amount: first,
        method: pick(PAYMENT_METHODS),
        date: payDate,
      });
      payments.push({
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        amount: second,
        method: pick(PAYMENT_METHODS),
        date: payDate,
      });
    }
  }

  return payments;
}

// ---------------------------------------------------------------------------
// Reset — removes only this script's rows, in foreign-key-safe order
// ---------------------------------------------------------------------------

async function resetPerformanceData(client: PoolClient): Promise<void> {
  const perfCustomers = `SELECT id FROM users WHERE email LIKE '${PERF_EMAIL_PREFIX}%${PERF_EMAIL_DOMAIN}'`;
  const perfSubscriptions = `SELECT id FROM subscriptions WHERE customer_id IN (${perfCustomers})`;
  const perfInvoices = `SELECT id FROM invoices WHERE subscription_id IN (${perfSubscriptions})`;

  const payments = await client.query(`DELETE FROM payments WHERE invoice_id IN (${perfInvoices})`);
  const invoices = await client.query(`DELETE FROM invoices WHERE subscription_id IN (${perfSubscriptions})`);
  const subscriptions = await client.query(
    `DELETE FROM subscriptions WHERE customer_id IN (${perfCustomers})`,
  );
  const users = await client.query(
    `DELETE FROM users WHERE email LIKE '${PERF_EMAIL_PREFIX}%${PERF_EMAIL_DOMAIN}'`,
  );

  logger.info(
    `Reset removed ${payments.rowCount ?? 0} payments, ${invoices.rowCount ?? 0} invoices, ` +
      `${subscriptions.rowCount ?? 0} subscriptions and ${users.rowCount ?? 0} perf customers.`,
  );
}

// ---------------------------------------------------------------------------
// Benchmarking
// ---------------------------------------------------------------------------

async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const result = await work();
  const elapsed = Math.round((performance.now() - startedAt) * 10) / 10;
  console.log(`  ${label.padEnd(38)} ${elapsed.toFixed(1).padStart(8)} ms`);
  return result;
}

async function explain(label: string, sql: string): Promise<void> {
  const result = await pool.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
  );
  console.log(`\n${label}`);
  for (const row of result.rows) console.log(`  ${row['QUERY PLAN']}`);
}

async function benchmarkDashboard(planId: number | undefined): Promise<void> {
  console.log('\nDashboard aggregates (real repository SQL):');
  await timed('Active contracts + MRR/ARR', () => financeRepository.subscriptionTotals({}));
  await timed('MRR by billing interval', () => financeRepository.mrrByInterval({}));
  await timed('Revenue collected', () => financeRepository.revenueTotals({}));
  await timed('Outstanding + overdue balances', () => financeRepository.invoiceTotals({}));
  await timed('Overdue chase list (LIMIT 50)', () => financeRepository.overdueInvoices({}, 50));
  if (planId !== undefined) {
    await timed('Filtered: single plan', () => financeRepository.subscriptionTotals({ planId }));
  }

  await explain(
    'Plan — active contracts and billable line subtotals',
    `WITH billable AS (
       SELECT s.id,
              p.billing_interval,
              COALESCE(SUM(l.subtotal), 0)::numeric(14,2) AS period_amount
         FROM subscriptions s
         JOIN subscription_plans p ON p.id = s.plan_id
         LEFT JOIN subscription_lines l
           ON l.subscription_id = s.id
          AND (l.is_addon = FALSE OR l.is_addon_active = TRUE)
        WHERE s.status = 'Active'
        GROUP BY s.id, p.billing_interval
     )
     SELECT COUNT(*)::int AS active_subscriptions,
            COALESCE(ROUND(SUM(CASE billing_interval
                                 WHEN 'daily'   THEN period_amount * 30
                                 WHEN 'weekly'  THEN period_amount * 4.3333
                                 WHEN 'monthly' THEN period_amount
                                 WHEN 'yearly'  THEN period_amount / 12
                               END), 2), 0)
       FROM billable`,
  );

  await explain(
    'Plan — confirmed invoice balances and overdue split',
    `SELECT COALESCE(SUM(i.total_amount - i.amount_paid)
                     FILTER (WHERE i.status = 'Confirmed' AND i.total_amount > i.amount_paid), 0)
              AS outstanding,
            COUNT(*) FILTER (WHERE i.status = 'Confirmed'
                               AND i.total_amount > i.amount_paid
                               AND i.due_date < CURRENT_DATE)::int AS overdue_invoices
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id`,
  );

  await explain(
    'Plan — collected revenue over a date window',
    `SELECT COUNT(*)::int, COALESCE(SUM(p.amount), 0)
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
      WHERE p.payment_date >= CURRENT_DATE - 30
        AND p.payment_date <= CURRENT_DATE`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readReferenceData(): Promise<{
  plans: PlanSeed[];
  products: ProductSeed[];
  taxRuleId: number | null;
  taxRate: number;
  recordedBy: number;
}> {
  const planResult = await pool.query<{ id: number; billing_interval: string; price: string }>(
    `SELECT id, billing_interval, price FROM subscription_plans ORDER BY id`,
  );
  if (planResult.rowCount === 0) {
    throw new Error('No subscription plans found. Run `npm run db:seed` first.');
  }

  const productResult = await pool.query<{
    id: number;
    name: string;
    type: string;
    sales_price: string;
  }>(`SELECT id, name, type, sales_price FROM products WHERE is_active = TRUE ORDER BY id`);
  if (productResult.rowCount === 0) {
    throw new Error('No active products found. Run `npm run db:seed` first.');
  }

  const taxResult = await pool.query<{ id: number; rate: string }>(
    `SELECT id, rate FROM tax_rules WHERE is_default = TRUE AND is_active = TRUE LIMIT 1`,
  );

  const staffResult = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE role IN ('ADMIN', 'STAFF') ORDER BY id ASC LIMIT 1`,
  );
  if (staffResult.rowCount === 0) {
    throw new Error('No internal staff account found. Run `npm run db:seed` first.');
  }

  return {
    plans: planResult.rows.map((row) => ({ id: row.id, interval: row.billing_interval })),
    products: productResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: Number.parseFloat(row.sales_price),
      isAddon: row.type === 'Add-on',
    })),
    taxRuleId: taxResult.rows[0]?.id ?? null,
    taxRate: taxResult.rows[0] ? Number.parseFloat(taxResult.rows[0].rate) : 18,
    recordedBy: staffResult.rows[0]!.id,
  };
}

async function main(): Promise<void> {
  const existing = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users WHERE email LIKE '${PERF_EMAIL_PREFIX}%${PERF_EMAIL_DOMAIN}'`,
  );
  const existingCount = Number(existing.rows[0]?.count ?? '0');

  if (existingCount > 0 && !RESET) {
    console.log(
      `Performance dataset already present (${existingCount} perf customers). ` +
        'Re-run with --reset to rebuild it from scratch.',
    );
    return;
  }

  const references = await readReferenceData();
  const passwordHash = await bcrypt.hash(PERF_PASSWORD, 10);

  const startedAt = performance.now();

  const summary = await withTransaction(async (client) => {
    if (existingCount > 0) await resetPerformanceData(client);

    const customerIds = await insertCustomers(client, passwordHash);
    const subscriptions = buildSubscriptions(customerIds, references.plans, references.products);
    const invoices = buildInvoices(subscriptions, references.taxRate);
    const payments = buildPayments(invoices);

    // --- subscriptions -----------------------------------------------------
    const subscriptionIdByNumber = new Map<string, number>();
    for (const batch of batches(subscriptions)) {
      const values = batch.flatMap((subscription) => [
        subscription.number,
        subscription.customerId,
        subscription.planId,
        subscription.status,
        subscription.startDate,
        subscription.expiryDate,
        subscription.paymentTerms,
        subscription.nextBillingDate,
        references.taxRuleId,
        'Performance dataset row',
      ]);
      const result = await client.query<{ id: number; subscription_number: string }>(
        `INSERT INTO subscriptions (
           subscription_number, customer_id, plan_id, status, start_date, expiry_date,
           payment_terms, next_billing_date, tax_rule_id, notes
         )
         VALUES ${buildTuples(batch.length, [
           'value', 'value', 'value', 'value', 'date', 'date',
           'value', 'date', 'value', 'value',
         ])}
         RETURNING id, subscription_number`,
        values,
      );
      for (const row of result.rows) {
        subscriptionIdByNumber.set(row.subscription_number, row.id);
      }
    }

    // --- subscription lines ------------------------------------------------
    const allLines = subscriptions.flatMap((subscription) =>
      subscription.lines.map((line) => ({
        subscriptionId: subscriptionIdByNumber.get(subscription.number)!,
        line,
      })),
    );
    for (const batch of batches(allLines)) {
      const values = batch.flatMap(({ subscriptionId, line }) => [
        subscriptionId,
        line.productId,
        line.description,
        line.quantity,
        line.unitPrice,
        line.subtotal,
        line.subtotal,
        line.isAddon,
        line.isAddonActive,
      ]);
      await client.query(
        `INSERT INTO subscription_lines (
           subscription_id, product_id, description, quantity, unit_price,
           subtotal, total_amount, is_addon, is_addon_active
         )
         VALUES ${buildTuples(batch.length, [
           'value', 'value', 'value', 'value', 'value', 'value', 'value', 'value', 'value',
         ])}`,
        values,
      );
    }

    // --- invoices ----------------------------------------------------------
    const invoiceIdByNumber = new Map<string, number>();
    for (const batch of batches(invoices)) {
      const values = batch.flatMap((invoice) => {
        const subscriptionId = subscriptionIdByNumber.get(invoice.subscriptionNumber)!;
        return [
          invoice.invoiceNumber,
          subscriptionId,
          invoice.customerId,
          invoice.billingCycleDate,
          // Same key the billing engine writes, so a later run recognises a
          // seeded cycle instead of colliding with its unique constraint.
          `sub_${subscriptionId}_${invoice.billingCycleDate}`,
          invoice.status,
          invoice.issueDate,
          invoice.dueDate,
          invoice.subtotal,
          invoice.taxTotal,
          0,
          invoice.totalAmount,
          invoice.amountPaid,
          invoice.status === 'Draft' ? null : timestampFor(invoice.issueDate),
          invoice.status === 'Cancelled' ? timestampFor(invoice.issueDate) : null,
        ];
      });
      const result = await client.query<{ id: number; invoice_number: string }>(
        `INSERT INTO invoices (
           invoice_number, subscription_id, customer_id, billing_cycle_date,
           billing_cycle_key, status, issue_date, due_date, subtotal, tax_total,
           discount_total, total_amount, amount_paid, sent_at, cancelled_at
         )
         VALUES ${buildTuples(batch.length, [
           'value', 'value', 'value', 'date', 'value', 'value', 'date', 'date',
           'value', 'value', 'value', 'value', 'value', 'value', 'value',
         ])}
         RETURNING id, invoice_number`,
        values,
      );
      for (const row of result.rows) invoiceIdByNumber.set(row.invoice_number, row.id);
    }

    // --- payments ----------------------------------------------------------
    let paymentSequence = 900_000;
    for (const batch of batches(payments)) {
      const values = batch.flatMap((payment) => {
        paymentSequence += 1;
        return [
          `PAY-2026-9${String(paymentSequence - 900_000).padStart(5, '0')}`,
          invoiceIdByNumber.get(payment.invoiceNumber)!,
          payment.customerId,
          payment.amount,
          payment.method,
          payment.date,
          'Seeded performance receipt',
          references.recordedBy,
        ];
      });
      await client.query(
        `INSERT INTO payments (
           payment_number, invoice_id, customer_id, amount, payment_method,
           payment_date, reference_note, recorded_by
         )
         VALUES ${buildTuples(batch.length, [
           'value', 'value', 'value', 'value', 'value', 'date', 'value', 'value',
         ])}`,
        values,
      );
    }

    return {
      customers: customerIds.length,
      subscriptions: subscriptions.length,
      lines: allLines.length,
      invoices: invoices.length,
      payments: payments.length,
    };
  });

  const elapsed = Math.round(performance.now() - startedAt);
  logger.info(
    `Performance seed complete in ${elapsed} ms: ${summary.customers} customers, ` +
      `${summary.subscriptions} subscriptions (${summary.lines} lines), ` +
      `${summary.invoices} invoices, ${summary.payments} payments.`,
  );

  /**
   * The hand-written document numbers live far above the seeded 1001+ range, so
   * the sequences are advanced past the highest value used here. Without this,
   * the first Billing Day run after seeding would collide with an existing
   * invoice number and violate uq_invoice_number.
   */
  await pool.query(
    `SELECT setval('seq_subscription_number',
                   GREATEST((SELECT COALESCE(MAX(substring(subscription_number FROM '([0-9]+)$')::bigint), 0)
                               FROM subscriptions),
                            (SELECT last_value FROM seq_subscription_number)),
                   true),
            setval('seq_invoice_number',
                   GREATEST((SELECT COALESCE(MAX(substring(invoice_number FROM '([0-9]+)$')::bigint), 0)
                               FROM invoices),
                            (SELECT last_value FROM seq_invoice_number)),
                   true),
            setval('seq_payment_number',
                   GREATEST((SELECT COALESCE(MAX(substring(payment_number FROM '([0-9]+)$')::bigint), 0)
                               FROM payments),
                            (SELECT last_value FROM seq_payment_number)),
                   true)`,
  );

  // Fresh statistics, or EXPLAIN would plan against the empty-table estimates.
  await pool.query('ANALYZE users, subscriptions, subscription_lines, invoices, payments');

  const counts = await pool.query<QueryResultRow & Record<string, string>>(`
    SELECT (SELECT COUNT(*)::text FROM subscriptions) AS subscriptions,
           (SELECT COUNT(*)::text FROM invoices)      AS invoices,
           (SELECT COUNT(*)::text FROM payments)      AS payments,
           (SELECT COALESCE(SUM(amount)::text, '0') FROM payments) AS collected
  `);
  const row = counts.rows[0]!;
  console.log(
    `\nTotals now in the database: ${row.subscriptions} subscriptions, ` +
      `${row.invoices} invoices, ${row.payments} payments, ` +
      `$${Number.parseFloat(row.collected).toFixed(2)} collected.`,
  );

  await benchmarkDashboard(references.plans[0]?.id);
}

main()
  .catch((error: unknown) => {
    logger.error(
      'Performance seeding failed',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => closePool());
