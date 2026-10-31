import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { PaymentMethod } from '../utils/payment.validators';
import { documentNumberExpression } from './document-number';

/**
 * SQL for the payment ledger. Every read joins back to the invoice, the paying
 * customer and the staff member who recorded it, so the API can show names
 * without the client issuing follow-up requests.
 */

export interface PaymentRow extends QueryResultRow {
  id: number;
  payment_number: string;
  invoice_id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  /** NUMERIC arrives as text; services convert it with toAmount. */
  amount: string;
  payment_method: PaymentMethod;
  /** DATE columns arrive as 'YYYY-MM-DD' text via the parser in db/pool.ts. */
  payment_date: string;
  reference_note: string | null;
  recorded_by: number;
  recorded_by_name: string;
  created_at: Date;
}

export interface NewPaymentInput {
  invoiceId: number;
  customerId: number;
  amount: number;
  method: PaymentMethod;
  date: string;
  note: string | null;
  recordedBy: number;
}

export interface PaymentFilter {
  invoiceId?: number;
  customerId?: number;
  /** Inclusive payment-date window. */
  from?: string;
  to?: string;
  limit?: number;
}

const PAYMENT_COLUMNS = `
  p.id, p.payment_number, p.invoice_id, i.invoice_number,
  p.customer_id, c.name AS customer_name,
  p.amount, p.payment_method, p.payment_date, p.reference_note,
  p.recorded_by, u.name AS recorded_by_name, p.created_at
`;

const PAYMENT_FROM = `
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  JOIN users c ON c.id = p.customer_id
  JOIN users u ON u.id = p.recorded_by
`;

function run<T extends QueryResultRow>(sql: string, params: readonly unknown[], client?: PoolClient) {
  return client ? client.query<T>(sql, params as unknown[]) : query<T>(sql, params);
}

/**
 * Newest first, capped at 100 by default. The history view never needs the
 * whole ledger in one response, and the cap keeps the page inside the
 * two-second budget once the table holds tens of thousands of rows.
 */
export async function listPayments(filter: PaymentFilter): Promise<PaymentRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.invoiceId !== undefined) {
    values.push(filter.invoiceId);
    conditions.push(`p.invoice_id = $${values.length}`);
  }
  if (filter.customerId !== undefined) {
    values.push(filter.customerId);
    conditions.push(`p.customer_id = $${values.length}`);
  }
  if (filter.from !== undefined) {
    values.push(filter.from);
    conditions.push(`p.payment_date >= $${values.length}::date`);
  }
  if (filter.to !== undefined) {
    values.push(filter.to);
    conditions.push(`p.payment_date <= $${values.length}::date`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(filter.limit ?? 100);

  const result = await query<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} ${where}
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT $${values.length}`,
    values,
  );
  return result.rows;
}

/** The history attached to one invoice, oldest first so balances read top-down. */
export async function listPaymentsForInvoice(
  invoiceId: number,
  client?: PoolClient,
): Promise<PaymentRow[]> {
  const result = await run<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
      WHERE p.invoice_id = $1
      ORDER BY p.payment_date ASC, p.id ASC`,
    [invoiceId],
    client,
  );
  return result.rows;
}

export async function findPaymentById(
  id: number,
  client?: PoolClient,
): Promise<PaymentRow | null> {
  const result = await run<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} WHERE p.id = $1`,
    [id],
    client,
  );
  return result.rows[0] ?? null;
}

/**
 * The number is drawn in SQL from seq_payment_number, so two clerks recording
 * payments at the same moment can never receive the same one — unlike a
 * "SELECT max(number) + 1" approach, which races. The row is always inserted
 * inside the caller's transaction, together with the invoice update it pays for.
 */
export async function insertPayment(
  input: NewPaymentInput,
  client: PoolClient,
): Promise<{ id: number; payment_number: string }> {
  const result = await client.query<{ id: number; payment_number: string }>(
    `INSERT INTO payments (
       payment_number, invoice_id, customer_id, amount, payment_method,
       payment_date, reference_note, recorded_by
     )
     VALUES (
       ${documentNumberExpression('PAY', 'seq_payment_number')},
       $1, $2, $3, $4, $5::date, $6, $7
     )
     RETURNING id, payment_number`,
    [
      input.invoiceId,
      input.customerId,
      input.amount,
      input.method,
      input.date,
      input.note,
      input.recordedBy,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error('Payment insert returned no row.');
  return row;
}
