import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { BillingInterval } from '../utils/catalog.validators';
import type { SubscriptionStatus } from '../utils/subscription.validators';
import { documentNumberExpression } from './document-number';
import { buildUpdateSet } from './update-builder';

export interface SubscriptionRow extends QueryResultRow {
  id: number;
  subscription_number: string;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  plan_id: number;
  plan_name: string;
  /** NUMERIC arrives as text; the service converts it with toAmount. */
  plan_price: string;
  billing_interval: BillingInterval;
  auto_close: boolean;
  allow_early_close: boolean;
  allow_pause: boolean;
  allow_renew: boolean;
  template_id: number | null;
  template_name: string | null;
  status: SubscriptionStatus;
  /** DATE columns arrive as 'YYYY-MM-DD' text via the parser in db/pool.ts. */
  start_date: string;
  expiry_date: string | null;
  payment_terms: string;
  next_billing_date: string | null;
  discount_rule_id: number | null;
  tax_rule_id: number | null;
  notes: string | null;
  paused_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SubscriptionLineRow extends QueryResultRow {
  id: number;
  subscription_id: number;
  product_id: number;
  product_name: string;
  product_type: string;
  variant_id: number | null;
  variant_attribute_name: string | null;
  variant_attribute_value: string | null;
  description: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  subtotal: string;
  total_amount: string;
  is_addon: boolean;
  is_addon_active: boolean;
}

export interface NewSubscriptionInput {
  customerId: number;
  planId: number;
  templateId: number | null;
  startDate: string;
  expiryDate: string | null;
  paymentTerms: string;
  notes: string | null;
}

export interface NewSubscriptionLineInput {
  productId: number;
  variantId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  totalAmount: number;
  isAddon: boolean;
}

export interface SubscriptionPatch {
  status?: SubscriptionStatus;
  startDate?: string;
  expiryDate?: string | null;
  nextBillingDate?: string | null;
  paymentTerms?: string;
  notes?: string | null;
  pausedAt?: Date | null;
  closedAt?: Date | null;
}

const SUBSCRIPTION_COLUMNS = `
  s.id, s.subscription_number, s.customer_id,
  c.name AS customer_name, c.email AS customer_email,
  s.plan_id, p.name AS plan_name, p.price AS plan_price,
  p.billing_interval, p.auto_close, p.allow_early_close, p.allow_pause, p.allow_renew,
  s.template_id, t.name AS template_name,
  s.status, s.start_date, s.expiry_date, s.payment_terms, s.next_billing_date,
  s.discount_rule_id, s.tax_rule_id,
  s.notes, s.paused_at, s.closed_at, s.created_at, s.updated_at
`;

const SUBSCRIPTION_FROM = `
  FROM subscriptions s
  JOIN users c ON c.id = s.customer_id
  JOIN subscription_plans p ON p.id = s.plan_id
  LEFT JOIN quotation_templates t ON t.id = s.template_id
`;

const LINE_COLUMNS = `
  l.id, l.subscription_id, l.product_id, pr.name AS product_name,
  pr.type AS product_type,
  l.variant_id, v.attribute_name AS variant_attribute_name,
  v.attribute_value AS variant_attribute_value,
  l.description, l.quantity, l.unit_price, l.discount_amount, l.tax_amount,
  l.subtotal, l.total_amount, l.is_addon, l.is_addon_active
`;

const SUBSCRIPTION_PATCH_COLUMNS: Readonly<Record<keyof SubscriptionPatch, string>> = {
  status: 'status',
  startDate: 'start_date',
  expiryDate: 'expiry_date',
  nextBillingDate: 'next_billing_date',
  paymentTerms: 'payment_terms',
  notes: 'notes',
  pausedAt: 'paused_at',
  closedAt: 'closed_at',
};

function run<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[],
  client?: PoolClient,
) {
  return client ? client.query<T>(sql, params as unknown[]) : query<T>(sql, params);
}

/**
 * `customerId` is the tenant filter: a customer session always supplies its own
 * id, so the portal can never read another account's contracts.
 */
export async function listSubscriptions(filter: {
  customerId?: number;
  status?: SubscriptionStatus;
}): Promise<SubscriptionRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.customerId !== undefined) {
    values.push(filter.customerId);
    conditions.push(`s.customer_id = $${values.length}`);
  }
  if (filter.status !== undefined) {
    values.push(filter.status);
    conditions.push(`s.status = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} ${SUBSCRIPTION_FROM} ${where}
      ORDER BY s.created_at DESC, s.id DESC`,
    values,
  );
  return result.rows;
}

export async function findSubscriptionById(
  id: number,
  client?: PoolClient,
): Promise<SubscriptionRow | null> {
  const result = await run<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} ${SUBSCRIPTION_FROM} WHERE s.id = $1`,
    [id],
    client,
  );
  return result.rows[0] ?? null;
}

/**
 * Takes a row lock for the duration of a transition. Two pause requests racing
 * on the same contract would otherwise both read `Active` and both succeed.
 */
export async function lockSubscription(
  id: number,
  client: PoolClient,
): Promise<{ id: number; status: SubscriptionStatus } | null> {
  const result = await client.query<{ id: number; status: SubscriptionStatus }>(
    `SELECT id, status FROM subscriptions WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listLinesForSubscription(
  subscriptionId: number,
  client?: PoolClient,
): Promise<SubscriptionLineRow[]> {
  return listLinesForSubscriptions([subscriptionId], client);
}

/** Every line for a page of subscriptions in one query — the list view is not N+1. */
export async function listLinesForSubscriptions(
  subscriptionIds: number[],
  client?: PoolClient,
): Promise<SubscriptionLineRow[]> {
  if (subscriptionIds.length === 0) return [];

  const result = await run<SubscriptionLineRow>(
    `SELECT ${LINE_COLUMNS}
       FROM subscription_lines l
       JOIN products pr ON pr.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
      WHERE l.subscription_id = ANY($1::int[])
      ORDER BY l.subscription_id ASC, l.is_addon ASC, l.id ASC`,
    [subscriptionIds],
    client,
  );
  return result.rows;
}

/**
 * The number is generated in SQL so the sequence and the formatted string can
 * never disagree, and so two concurrent creates cannot both read "the next one".
 */
export async function insertSubscription(
  input: NewSubscriptionInput,
  client: PoolClient,
): Promise<{ id: number; subscription_number: string }> {
  const result = await client.query<{ id: number; subscription_number: string }>(
    `INSERT INTO subscriptions (
       subscription_number, customer_id, plan_id, template_id, status,
       start_date, expiry_date, payment_terms, next_billing_date, notes
     )
     VALUES (
       ${documentNumberExpression('SUB', 'seq_subscription_number')},
       $1, $2, $3, 'Draft', $4, $5, $6, $4, $7
     )
     RETURNING id, subscription_number`,
    [
      input.customerId,
      input.planId,
      input.templateId,
      input.startDate,
      input.expiryDate,
      input.paymentTerms,
      input.notes,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Subscription insert returned no row.');
  return row;
}

/** One multi-row INSERT for the whole contract, inside the caller's transaction. */
export async function insertSubscriptionLines(
  subscriptionId: number,
  lines: NewSubscriptionLineInput[],
  client: PoolClient,
): Promise<void> {
  if (lines.length === 0) return;

  const values: unknown[] = [];
  const tuples = lines.map((line, index) => {
    const base = index * 10;
    values.push(
      subscriptionId,
      line.productId,
      line.variantId,
      line.description,
      line.quantity,
      line.unitPrice,
      0,
      0,
      line.subtotal,
      line.totalAmount,
    );
    const placeholders = Array.from({ length: 10 }, (_, offset) => `$${base + offset + 1}`);
    // is_addon and is_addon_active are not in the tuple: they follow the product type.
    return `(${placeholders.join(', ')}, ${line.isAddon}, TRUE)`;
  });

  await client.query(
    `INSERT INTO subscription_lines (
       subscription_id, product_id, variant_id, description, quantity, unit_price,
       discount_amount, tax_amount, subtotal, total_amount, is_addon, is_addon_active
     )
     VALUES ${tuples.join(', ')}`,
    values,
  );
}

export async function updateSubscription(
  id: number,
  patch: SubscriptionPatch,
  client: PoolClient,
): Promise<boolean> {
  const { clause, values } = buildUpdateSet(patch, SUBSCRIPTION_PATCH_COLUMNS);
  const result = await client.query(
    `UPDATE subscriptions SET ${clause} WHERE id = $${values.length + 1}`,
    [...values, id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggling an add-on rewrites its stored totals rather than leaving stale
 * amounts behind: an inactive add-on is worth exactly zero on this contract.
 */
export async function updateAddonLine(
  lineId: number,
  isActive: boolean,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE subscription_lines
        SET is_addon_active = $2,
            subtotal = CASE WHEN $2 THEN quantity * unit_price ELSE 0 END,
            total_amount = CASE
                WHEN $2 THEN GREATEST(quantity * unit_price - discount_amount + tax_amount, 0)
                ELSE 0
            END
      WHERE id = $1`,
    [lineId, isActive],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Reopens a closed contract. The new expiry is derived from the plan interval
 * in SQL so month and year lengths are PostgreSQL's problem, not ours.
 */
export async function renewSubscription(
  id: number,
  startDate: string | null,
  expiryDate: string | null,
  interval: string,
  paymentTerms: string | null,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE subscriptions
        SET status = 'Active',
            start_date = COALESCE($2::date, CURRENT_DATE),
            expiry_date = COALESCE($3::date, COALESCE($2::date, CURRENT_DATE) + $4::interval),
            next_billing_date = COALESCE($2::date, CURRENT_DATE),
            payment_terms = COALESCE($5, payment_terms),
            paused_at = NULL,
            closed_at = NULL
      WHERE id = $1`,
    [id, startDate, expiryDate, interval, paymentTerms],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Billing day
// ---------------------------------------------------------------------------

/**
 * Every contract the billing run must consider. The partial index
 * idx_subs_active_billing covers this predicate, so the scan cost stays flat
 * as the subscriptions table grows.
 */
export async function listDueSubscriptions(): Promise<SubscriptionRow[]> {
  const result = await query<SubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} ${SUBSCRIPTION_FROM}
      WHERE s.status = 'Active'
        AND s.next_billing_date IS NOT NULL
        AND s.next_billing_date <= CURRENT_DATE
      ORDER BY s.next_billing_date ASC, s.id ASC`,
  );
  return result.rows;
}

export interface BillingLockRow {
  id: number;
  subscription_number: string;
  customer_id: number;
  customer_name: string;
  status: SubscriptionStatus;
  next_billing_date: string | null;
  expiry_date: string | null;
  payment_terms: string;
  discount_rule_id: number | null;
  tax_rule_id: number | null;
  billing_interval: BillingInterval;
  auto_close: boolean;
  plan_name: string;
}

/**
 * Re-reads the row under `FOR UPDATE` inside the billing transaction. The list
 * query that picked the candidate is unlocked, so the state could have moved on
 * (a pause, a manual close) between selection and processing.
 */
export async function lockSubscriptionForBilling(
  id: number,
  client: PoolClient,
): Promise<BillingLockRow | null> {
  const result = await client.query<BillingLockRow>(
    `SELECT s.id, s.subscription_number, s.customer_id, c.name AS customer_name,
            s.status, s.next_billing_date, s.expiry_date, s.payment_terms,
            s.discount_rule_id, s.tax_rule_id,
            p.billing_interval, p.auto_close, p.name AS plan_name
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
       JOIN users c ON c.id = s.customer_id
      WHERE s.id = $1
      FOR UPDATE OF s`,
    [id],
  );
  return result.rows[0] ?? null;
}

const BILLING_INTERVAL_SQL: Readonly<Record<BillingInterval, string>> = {
  daily: '1 day',
  weekly: '7 days',
  monthly: '1 month',
  yearly: '1 year',
};

export function intervalSql(interval: BillingInterval): string {
  return BILLING_INTERVAL_SQL[interval];
}

/**
 * Moves the contract to its next cycle and records which discount (if any) the
 * invoice consumed.
 *
 * The CASE guards the no-double-bill rule: if advancing one interval still
 * lands on or before today (a contract that was dormant longer than a cycle),
 * the date jumps to the next interval after today instead of leaving the
 * contract due and allowing a second run to bill it again the same day.
 */
export async function advanceBillingCycle(
  id: number,
  interval: BillingInterval,
  discountRuleId: number | null,
  client: PoolClient,
): Promise<string | null> {
  const result = await client.query<{ next_billing_date: string | null }>(
    `UPDATE subscriptions
        SET next_billing_date = CASE
              WHEN next_billing_date + $2::interval > CURRENT_DATE
                THEN next_billing_date + $2::interval
              ELSE CURRENT_DATE + $2::interval
            END,
            discount_rule_id = $3
      WHERE id = $1
      RETURNING next_billing_date`,
    [id, intervalSql(interval), discountRuleId],
  );
  return result.rows[0]?.next_billing_date ?? null;
}

export interface ExpiringSubscriptionRow extends QueryResultRow {
  id: number;
  subscription_number: string;
  customer_id: number;
  expiry_date: string;
}

/** Active contracts whose plan says they close at expiry, and whose expiry has passed. */
export async function listExpiredAutoCloseSubscriptions(
  client?: PoolClient,
): Promise<ExpiringSubscriptionRow[]> {
  const sql = `
    SELECT s.id, s.subscription_number, s.customer_id, s.expiry_date
      FROM subscriptions s
      JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.status = 'Active'
       AND p.auto_close = TRUE
       AND s.expiry_date IS NOT NULL
       AND s.expiry_date < CURRENT_DATE
     ORDER BY s.expiry_date ASC, s.id ASC
  `;
  const result = client ? await client.query<ExpiringSubscriptionRow>(sql) : await query<ExpiringSubscriptionRow>(sql);
  return result.rows;
}

/**
 * Closes every contract past its auto-close date in one statement. RETURNING
 * gives the run an audit trail without a second SELECT.
 */
export async function closeExpiredAutoCloseSubscriptions(
  client: PoolClient,
): Promise<ExpiringSubscriptionRow[]> {
  const result = await client.query<ExpiringSubscriptionRow>(
    `UPDATE subscriptions s
        SET status = 'Closed', closed_at = CURRENT_TIMESTAMP
       FROM subscription_plans p
      WHERE p.id = s.plan_id
        AND s.status = 'Active'
        AND p.auto_close = TRUE
        AND s.expiry_date IS NOT NULL
        AND s.expiry_date < CURRENT_DATE
      RETURNING s.id, s.subscription_number, s.customer_id, s.expiry_date`,
  );
  return result.rows;
}
