import type { QueryResultRow } from 'pg';
import { query } from '../db/pool';

/**
 * The dashboard's section cards only need counts, so each figure is one
 * GROUP BY aggregate rather than a list of rows added up in the browser. That
 * keeps the payload the same size whether the catalogue holds six products or
 * six thousand, and lets PostgreSQL answer from the indexes the catalogue and
 * ledger tables already carry.
 */

export interface StatusCountRow extends QueryResultRow {
  status: string;
  count: number;
}

export interface InvoiceStatusRow extends QueryResultRow {
  status: string;
  count: number;
  amount: string;
}

export interface ProductTypeRow extends QueryResultRow {
  type: string;
  count: number;
  active: number;
}

export interface CountPairRow extends QueryResultRow {
  total: number;
  active: number;
}

export interface SingleCountRow extends QueryResultRow {
  total: number;
}

export interface DiscountTotalsRow extends QueryResultRow {
  total: number;
  active: number;
  uses_remaining: number;
}

export interface TaxTotalsRow extends QueryResultRow {
  total: number;
  active: number;
  default_rate: string;
}

export async function invoiceStatusTotals(): Promise<InvoiceStatusRow[]> {
  const result = await query<InvoiceStatusRow>(
    `SELECT status,
            COUNT(*)::int                    AS count,
            COALESCE(SUM(total_amount), 0)   AS amount
       FROM invoices
      GROUP BY status
      ORDER BY status`,
  );
  return result.rows;
}

export async function subscriptionStatusTotals(): Promise<StatusCountRow[]> {
  const result = await query<StatusCountRow>(
    `SELECT status, COUNT(*)::int AS count
       FROM subscriptions
      GROUP BY status
      ORDER BY status`,
  );
  return result.rows;
}

export async function productTypeTotals(): Promise<ProductTypeRow[]> {
  const result = await query<ProductTypeRow>(
    `SELECT type,
            COUNT(*)::int                             AS count,
            COUNT(*) FILTER (WHERE is_active)::int    AS active
       FROM products
      GROUP BY type
      ORDER BY type`,
  );
  return result.rows;
}

export async function planTotals(): Promise<CountPairRow> {
  const result = await query<CountPairRow>(
    `SELECT COUNT(*)::int                         AS total,
            COUNT(*) FILTER (WHERE is_active)::int AS active
       FROM subscription_plans`,
  );
  return result.rows[0] ?? { total: 0, active: 0 };
}

export async function templateTotals(): Promise<SingleCountRow> {
  const result = await query<SingleCountRow>(
    `SELECT COUNT(*)::int AS total FROM quotation_templates`,
  );
  return result.rows[0] ?? { total: 0 };
}

export async function discountTotals(): Promise<DiscountTotalsRow> {
  const result = await query<DiscountTotalsRow>(
    `SELECT COUNT(*)::int                                                    AS total,
            COUNT(*) FILTER (WHERE is_active)::int                           AS active,
            COALESCE(SUM(GREATEST(max_uses - current_uses, 0))
                     FILTER (WHERE is_active), 0)::int                      AS uses_remaining
       FROM discount_rules`,
  );
  return result.rows[0] ?? { total: 0, active: 0, uses_remaining: 0 };
}

export async function taxTotals(): Promise<TaxTotalsRow> {
  const result = await query<TaxTotalsRow>(
    `SELECT COUNT(*)::int                                       AS total,
            COUNT(*) FILTER (WHERE is_active)::int              AS active,
            COALESCE(MAX(rate) FILTER (WHERE is_default), 0)    AS default_rate
       FROM tax_rules`,
  );
  return result.rows[0] ?? { total: 0, active: 0, default_rate: '0' };
}
