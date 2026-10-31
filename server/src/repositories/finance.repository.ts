import type { QueryResultRow } from 'pg';
import { query } from '../db/pool';

/**
 * Every figure on the finance dashboard is produced by PostgreSQL — COUNT,
 * SUM and FILTER aggregates over indexed columns. Nothing is summed in
 * JavaScript, so the same numbers appear whether one row or a hundred thousand
 * rows are read, and the cost stays inside the database's aggregate pipeline
 * instead of growing with the size of a JSON response.
 */

export interface FinanceFilter {
  /** Inclusive issue-date / payment-date window. */
  startDate?: string;
  endDate?: string;
  planId?: number;
  customerId?: number;
}

export interface SubscriptionTotalsRow extends QueryResultRow {
  active_subscriptions: number;
  mrr: string;
  arr: string;
}

export interface IntervalSliceRow extends QueryResultRow {
  billing_interval: string;
  subscriptions: number;
  mrr: string;
}

export interface RevenueTotalsRow extends QueryResultRow {
  total_payments: number;
  collected: string;
}

export interface InvoiceTotalsRow extends QueryResultRow {
  outstanding: string;
  open_invoices: number;
  overdue: string;
  overdue_invoices: number;
}

export interface OverdueInvoiceRow extends QueryResultRow {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  customer_company: string | null;
  subscription_number: string;
  plan_name: string;
  issue_date: string;
  due_date: string;
  days_overdue: number;
  total_amount: string;
  amount_paid: string;
  balance_due: string;
}

export interface PlanOptionRow extends QueryResultRow {
  id: number;
  name: string;
  billing_interval: string;
}

export interface CustomerOptionRow extends QueryResultRow {
  id: number;
  name: string;
  email: string;
  company_name: string | null;
}

/**
 * Appends the subscription-scope conditions (plan and customer) to a WHERE
 * clause. The date window is deliberately not applied here: "active
 * subscriptions" and MRR are a snapshot of the contracts in force today, not a
 * flow over a period, so narrowing them by invoice dates would make the KPI
 * disagree with the contracts list on the next screen.
 */
function subscriptionScope(filter: FinanceFilter, values: unknown[]): string {
  const conditions: string[] = [];
  if (filter.planId !== undefined) {
    values.push(filter.planId);
    conditions.push(`s.plan_id = $${values.length}`);
  }
  if (filter.customerId !== undefined) {
    values.push(filter.customerId);
    conditions.push(`s.customer_id = $${values.length}`);
  }
  return conditions.map((condition) => ` AND ${condition}`).join('');
}

/** Issue-date window for invoices, applied only inside the invoice queries. */
function invoiceDateWindow(filter: FinanceFilter, values: unknown[], alias = 'i'): string {
  const conditions: string[] = [];
  if (filter.startDate !== undefined) {
    values.push(filter.startDate);
    conditions.push(`${alias}.issue_date >= $${values.length}::date`);
  }
  if (filter.endDate !== undefined) {
    values.push(filter.endDate);
    conditions.push(`${alias}.issue_date <= $${values.length}::date`);
  }
  return conditions.map((condition) => ` AND ${condition}`).join('');
}

const MRR_FACTOR = `CASE billing_interval
    WHEN 'daily'   THEN period_amount * 30
    WHEN 'weekly'  THEN period_amount * 4.3333
    WHEN 'monthly' THEN period_amount
    WHEN 'yearly'  THEN period_amount / 12
  END`;

const ARR_FACTOR = `CASE billing_interval
    WHEN 'daily'   THEN period_amount * 365
    WHEN 'weekly'  THEN period_amount * 52
    WHEN 'monthly' THEN period_amount * 12
    WHEN 'yearly'  THEN period_amount
  END`;

/**
 * One row per active contract holding only its billable periodic amount.
 * Paused add-ons are excluded so a switched-off extra never inflates MRR; the
 * core product lines (is_addon = FALSE) always count.
 */
function billableCte(filter: FinanceFilter, values: unknown[]): string {
  return `
    WITH billable AS (
      SELECT s.id,
             p.billing_interval,
             COALESCE(SUM(l.subtotal), 0)::numeric(14,2) AS period_amount
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        LEFT JOIN subscription_lines l
          ON l.subscription_id = s.id
         AND (l.is_addon = FALSE OR l.is_addon_active = TRUE)
       WHERE s.status = 'Active'${subscriptionScope(filter, values)}
       GROUP BY s.id, p.billing_interval
    )`;
}

export async function subscriptionTotals(filter: FinanceFilter): Promise<SubscriptionTotalsRow> {
  const values: unknown[] = [];
  const cte = billableCte(filter, values);

  const result = await query<SubscriptionTotalsRow>(
    `${cte}
     SELECT COUNT(*)::int AS active_subscriptions,
            COALESCE(ROUND(SUM(${MRR_FACTOR}), 2), 0)::text AS mrr,
            COALESCE(ROUND(SUM(${ARR_FACTOR}), 2), 0)::text AS arr
       FROM billable`,
    values,
  );

  return result.rows[0] ?? { active_subscriptions: 0, mrr: '0', arr: '0' };
}

/** MRR split by billing cadence — shows which rhythm carries the revenue. */
export async function mrrByInterval(filter: FinanceFilter): Promise<IntervalSliceRow[]> {
  const values: unknown[] = [];
  const cte = billableCte(filter, values);

  const result = await query<IntervalSliceRow>(
    `${cte}
     SELECT billing_interval,
            COUNT(*)::int AS subscriptions,
            COALESCE(ROUND(SUM(${MRR_FACTOR}), 2), 0)::text AS mrr
       FROM billable
      GROUP BY billing_interval
      ORDER BY CASE billing_interval
                 WHEN 'monthly' THEN 1
                 WHEN 'yearly'  THEN 2
                 WHEN 'weekly'  THEN 3
                 WHEN 'daily'   THEN 4
               END`,
    values,
  );

  return result.rows;
}

/**
 * Cash actually collected. The date window uses `payment_date` (when the money
 * arrived), not the invoice's issue date, so a late payment lands in the month
 * the bank saw it.
 */
export async function revenueTotals(filter: FinanceFilter): Promise<RevenueTotalsRow> {
  const values: unknown[] = [];
  const conditions: string[] = [];

  if (filter.startDate !== undefined) {
    values.push(filter.startDate);
    conditions.push(`p.payment_date >= $${values.length}::date`);
  }
  if (filter.endDate !== undefined) {
    values.push(filter.endDate);
    conditions.push(`p.payment_date <= $${values.length}::date`);
  }
  if (filter.customerId !== undefined) {
    values.push(filter.customerId);
    conditions.push(`p.customer_id = $${values.length}`);
  }
  if (filter.planId !== undefined) {
    values.push(filter.planId);
    conditions.push(`s.plan_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query<RevenueTotalsRow>(
    `SELECT COUNT(*)::int AS total_payments,
            COALESCE(SUM(p.amount), 0)::text AS collected
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
       ${where}`,
    values,
  );

  return result.rows[0] ?? { total_payments: 0, collected: '0' };
}

/**
 * What is still owed. `Confirmed` is the only status that represents money the
 * customer has been asked for: a Draft has not been sent and a Cancelled
 * invoice must never reappear as debt. Invoices whose balance has already
 * reached zero are excluded so a rounding residue cannot pollute the KPI.
 */
export async function invoiceTotals(filter: FinanceFilter): Promise<InvoiceTotalsRow> {
  const values: unknown[] = [];
  const dateWindow = invoiceDateWindow(filter, values);

  const result = await query<InvoiceTotalsRow>(
    `SELECT COALESCE(SUM(i.total_amount - i.amount_paid)
                     FILTER (WHERE i.status = 'Confirmed' AND i.total_amount > i.amount_paid), 0)::text
              AS outstanding,
            COUNT(*) FILTER (WHERE i.status = 'Confirmed' AND i.total_amount > i.amount_paid)::int
              AS open_invoices,
            COALESCE(SUM(i.total_amount - i.amount_paid)
                     FILTER (WHERE i.status = 'Confirmed'
                               AND i.total_amount > i.amount_paid
                               AND i.due_date < CURRENT_DATE), 0)::text
              AS overdue,
            COUNT(*) FILTER (WHERE i.status = 'Confirmed'
                               AND i.total_amount > i.amount_paid
                               AND i.due_date < CURRENT_DATE)::int
              AS overdue_invoices
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
      WHERE TRUE${dateWindow}${subscriptionScope(filter, values)}`,
    values,
  );

  return (
    result.rows[0] ?? {
      outstanding: '0',
      open_invoices: 0,
      overdue: '0',
      overdue_invoices: 0,
    }
  );
}

/**
 * The chase list. Ordered oldest due date first because that is the collection
 * priority, and capped because the dashboard is a summary, not a ledger export.
 */
export async function overdueInvoices(
  filter: FinanceFilter,
  limit = 50,
): Promise<OverdueInvoiceRow[]> {
  const values: unknown[] = [];
  const dateWindow = invoiceDateWindow(filter, values);
  const scope = subscriptionScope(filter, values);
  values.push(limit);

  const result = await query<OverdueInvoiceRow>(
    `SELECT i.id, i.invoice_number, i.customer_id,
            c.name AS customer_name, c.email AS customer_email,
            c.company_name AS customer_company,
            s.subscription_number, p.name AS plan_name,
            i.issue_date, i.due_date,
            (CURRENT_DATE - i.due_date)::int AS days_overdue,
            i.total_amount, i.amount_paid,
            (i.total_amount - i.amount_paid)::numeric(12,2) AS balance_due
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN subscription_plans p ON p.id = s.plan_id
       JOIN users c ON c.id = i.customer_id
      WHERE i.status = 'Confirmed'
        AND i.total_amount > i.amount_paid
        AND i.due_date < CURRENT_DATE${dateWindow}${scope}
      ORDER BY i.due_date ASC, i.id ASC
      LIMIT $${values.length}`,
    values,
  );

  return result.rows;
}

/**
 * Options the toolbar may offer. Only plans and customers that actually own a
 * contract are returned, so the finance lead never filters on an empty slice.
 */
export async function planOptions(): Promise<PlanOptionRow[]> {
  const result = await query<PlanOptionRow>(
    `SELECT p.id, p.name, p.billing_interval
       FROM subscription_plans p
      WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.plan_id = p.id)
      ORDER BY p.name ASC`,
  );
  return result.rows;
}

export async function customerOptions(): Promise<CustomerOptionRow[]> {
  const result = await query<CustomerOptionRow>(
    `SELECT u.id, u.name, u.email, u.company_name
       FROM users u
      WHERE u.role = 'CUSTOMER'
        AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id = u.id)
      ORDER BY u.name ASC, u.id ASC`,
  );
  return result.rows;
}

/** Filter-target validation: an unknown id should be named, not ignored. */
export async function planExists(id: number): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM subscription_plans WHERE id = $1) AS exists`,
    [id],
  );
  return result.rows[0]?.exists ?? false;
}

export async function customerExists(id: number): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND role = 'CUSTOMER') AS exists`,
    [id],
  );
  return result.rows[0]?.exists ?? false;
}
