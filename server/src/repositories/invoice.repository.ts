import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { InvoiceStatus } from '../utils/billing.validators';
import { buildUpdateSet } from './update-builder';

export interface InvoiceRow extends QueryResultRow {
  id: number;
  invoice_number: string;
  subscription_id: number;
  subscription_number: string;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  customer_company: string | null;
  customer_address: string | null;
  plan_name: string;
  payment_terms: string;
  /** DATE columns arrive as 'YYYY-MM-DD' text via the parser in db/pool.ts. */
  billing_cycle_date: string;
  billing_cycle_key: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  /** NUMERIC arrives as text; services convert it with toAmount. */
  subtotal: string;
  tax_total: string;
  discount_total: string;
  total_amount: string;
  amount_paid: string;
  sent_at: Date | null;
  cancelled_at: Date | null;
  notes: string | null;
  is_overdue: boolean;
  days_overdue: number;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceLineRow extends QueryResultRow {
  id: number;
  invoice_id: number;
  product_id: number;
  product_name: string;
  variant_id: number | null;
  variant_attribute_name: string | null;
  variant_attribute_value: string | null;
  description: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  tax_rule_id: number | null;
  tax_name: string | null;
  tax_rate: string;
  discount_rule_id: number | null;
  discount_code: string | null;
}

export interface NewInvoiceInput {
  subscriptionId: number;
  customerId: number;
  billingCycleDate: string;
  billingCycleKey: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalAmount: number;
  notes: string | null;
}

export interface NewInvoiceLineInput {
  productId: number;
  variantId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxRuleId: number | null;
  taxName: string | null;
  taxRate: number;
  discountRuleId: number | null;
}

export interface InvoicePatch {
  status?: InvoiceStatus;
  amountPaid?: number;
  sentAt?: Date | null;
  cancelledAt?: Date | null;
  notes?: string | null;
}

const INVOICE_COLUMNS = `
  i.id, i.invoice_number, i.subscription_id, s.subscription_number,
  i.customer_id, c.name AS customer_name, c.email AS customer_email,
  c.company_name AS customer_company, c.address AS customer_address,
  p.name AS plan_name, s.payment_terms,
  i.billing_cycle_date, i.billing_cycle_key, i.status, i.issue_date, i.due_date,
  i.subtotal, i.tax_total, i.discount_total, i.total_amount, i.amount_paid,
  i.sent_at, i.cancelled_at, i.notes, i.created_at, i.updated_at,
  (i.status IN ('Draft', 'Confirmed') AND i.due_date < CURRENT_DATE) AS is_overdue,
  CASE
    WHEN i.status IN ('Draft', 'Confirmed') AND i.due_date < CURRENT_DATE
    THEN (CURRENT_DATE - i.due_date)
    ELSE 0
  END AS days_overdue
`;

const INVOICE_FROM = `
  FROM invoices i
  JOIN subscriptions s ON s.id = i.subscription_id
  JOIN subscription_plans p ON p.id = s.plan_id
  JOIN users c ON c.id = i.customer_id
`;

const LINE_COLUMNS = `
  l.id, l.invoice_id, l.product_id, pr.name AS product_name,
  l.variant_id, v.attribute_name AS variant_attribute_name,
  v.attribute_value AS variant_attribute_value,
  l.description, l.quantity, l.unit_price, l.discount_amount, l.tax_amount,
  l.total_amount, l.tax_rule_id, l.tax_name, l.tax_rate, l.discount_rule_id,
  d.code AS discount_code
`;

const INVOICE_PATCH_COLUMNS: Readonly<Record<keyof InvoicePatch, string>> = {
  status: 'status',
  amountPaid: 'amount_paid',
  sentAt: 'sent_at',
  cancelledAt: 'cancelled_at',
  notes: 'notes',
};

function run<T extends QueryResultRow>(sql: string, params: readonly unknown[], client?: PoolClient) {
  return client ? client.query<T>(sql, params as unknown[]) : query<T>(sql, params);
}

export interface InvoiceFilter {
  customerId?: number;
  status?: InvoiceStatus;
  /** Inclusive issue-date window. */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * The list is capped. The finance views never need every invoice in one
 * response, and a cap keeps the page inside the two-second budget once the
 * ledger holds thousands of rows.
 */
export async function listInvoices(filter: InvoiceFilter): Promise<InvoiceRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.customerId !== undefined) {
    values.push(filter.customerId);
    conditions.push(`i.customer_id = $${values.length}`);
  }
  if (filter.status !== undefined) {
    values.push(filter.status);
    conditions.push(`i.status = $${values.length}`);
  }
  if (filter.from !== undefined) {
    values.push(filter.from);
    conditions.push(`i.issue_date >= $${values.length}::date`);
  }
  if (filter.to !== undefined) {
    values.push(filter.to);
    conditions.push(`i.issue_date <= $${values.length}::date`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(filter.limit ?? 100);

  const result = await query<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} ${where}
      ORDER BY i.issue_date DESC, i.id DESC
      LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

export async function findInvoiceById(
  id: number,
  client?: PoolClient,
): Promise<InvoiceRow | null> {
  const result = await run<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} WHERE i.id = $1`,
    [id],
    client,
  );
  return result.rows[0] ?? null;
}

/**
 * The idempotency lookup. `billing_cycle_key` is unique, so finding a row here
 * means this exact subscription cycle has already been billed.
 */
export async function findInvoiceByCycleKey(
  key: string,
  client?: PoolClient,
): Promise<{ id: number; invoice_number: string } | null> {
  const result = await run<{ id: number; invoice_number: string }>(
    `SELECT id, invoice_number FROM invoices WHERE billing_cycle_key = $1 LIMIT 1`,
    [key],
    client,
  );
  return result.rows[0] ?? null;
}

export async function lockInvoice(
  id: number,
  client: PoolClient,
): Promise<{ id: number; status: InvoiceStatus } | null> {
  const result = await client.query<{ id: number; status: InvoiceStatus }>(
    `SELECT id, status FROM invoices WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * The number is generated in SQL from seq_invoice_number so two concurrent
 * billing runs can never read the same "next" value. RETURNING hands back the
 * formatted string as well as the id.
 */
export async function insertInvoice(
  input: NewInvoiceInput,
  client: PoolClient,
): Promise<{ id: number; invoice_number: string }> {
  const result = await client.query<{ id: number; invoice_number: string }>(
    `INSERT INTO invoices (
       invoice_number, subscription_id, customer_id, billing_cycle_date,
       billing_cycle_key, status, issue_date, due_date,
       subtotal, tax_total, discount_total, total_amount, amount_paid, notes
     )
     VALUES (
       'INV-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
         lpad(nextval('seq_invoice_number')::text, 4, '0'),
       $1, $2, $3::date, $4, 'Draft', $5::date, $6::date,
       $7, $8, $9, $10, 0, $11
     )
     RETURNING id, invoice_number`,
    [
      input.subscriptionId,
      input.customerId,
      input.billingCycleDate,
      input.billingCycleKey,
      input.issueDate,
      input.dueDate,
      input.subtotal,
      input.taxTotal,
      input.discountTotal,
      input.totalAmount,
      input.notes,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Invoice insert returned no row.');
  return row;
}

/** One multi-row INSERT for the whole invoice, inside the caller's transaction. */
export async function insertInvoiceLines(
  invoiceId: number,
  lines: NewInvoiceLineInput[],
  client: PoolClient,
): Promise<void> {
  if (lines.length === 0) return;

  const values: unknown[] = [];
  const tuples = lines.map((line, index) => {
    const base = index * 13;
    values.push(
      invoiceId,
      line.productId,
      line.variantId,
      line.description,
      line.quantity,
      line.unitPrice,
      line.discountAmount,
      line.taxAmount,
      line.totalAmount,
      line.taxRuleId,
      line.taxName,
      line.taxRate,
      line.discountRuleId,
    );
    const placeholders = Array.from({ length: 13 }, (_, offset) => `$${base + offset + 1}`);
    return `(${placeholders.join(', ')})`;
  });

  await client.query(
    `INSERT INTO invoice_lines (
       invoice_id, product_id, variant_id, description, quantity, unit_price,
       discount_amount, tax_amount, total_amount, tax_rule_id, tax_name, tax_rate,
       discount_rule_id
     )
     VALUES ${tuples.join(', ')}`,
    values,
  );
}

export async function updateInvoice(
  id: number,
  patch: InvoicePatch,
  client?: PoolClient,
): Promise<boolean> {
  const { clause, values } = buildUpdateSet(patch, INVOICE_PATCH_COLUMNS);
  const result = await run<QueryResultRow>(
    `UPDATE invoices SET ${clause} WHERE id = $${values.length + 1}`,
    [...values, id],
    client,
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listLinesForInvoice(
  invoiceId: number,
  client?: PoolClient,
): Promise<InvoiceLineRow[]> {
  const result = await run<InvoiceLineRow>(
    `SELECT ${LINE_COLUMNS}
       FROM invoice_lines l
       JOIN products pr ON pr.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       LEFT JOIN discount_rules d ON d.id = l.discount_rule_id
      WHERE l.invoice_id = $1
      ORDER BY l.id ASC`,
    [invoiceId],
    client,
  );
  return result.rows;
}
