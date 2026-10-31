import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { BillingInterval } from '../utils/catalog.validators';
import type { SubscriptionStatus } from '../utils/subscription.validators';
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
       'SUB-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
         lpad(nextval('seq_subscription_number')::text, 4, '0'),
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
