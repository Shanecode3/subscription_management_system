import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { DiscountScope, DiscountType } from '../utils/billing.validators';
import { buildUpdateSet } from './update-builder';

export interface DiscountRuleRow extends QueryResultRow {
  id: number;
  name: string;
  code: string;
  discount_type: DiscountType;
  /** NUMERIC arrives as text; services convert it with toAmount. */
  discount_value: string;
  scope: DiscountScope;
  target_product_id: number | null;
  target_product_name: string | null;
  min_purchase_amount: string;
  min_quantity: number;
  /** DATE columns arrive as 'YYYY-MM-DD' text via the parser in db/pool.ts. */
  start_date: string;
  end_date: string;
  max_uses: number;
  current_uses: number;
  is_active: boolean;
  created_by: number;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
}

export interface NewDiscountRuleInput {
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  scope: DiscountScope;
  targetProductId: number | null;
  minPurchaseAmount: number;
  minQuantity: number;
  startDate: string;
  endDate: string;
  maxUses: number;
  createdBy: number;
}

export interface DiscountRulePatch {
  name?: string;
  code?: string;
  discountType?: DiscountType;
  discountValue?: number;
  scope?: DiscountScope;
  targetProductId?: number | null;
  minPurchaseAmount?: number;
  minQuantity?: number;
  startDate?: string;
  endDate?: string;
  maxUses?: number;
  isActive?: boolean;
}

const DISCOUNT_COLUMNS = `
  d.id, d.name, d.code, d.discount_type, d.discount_value, d.scope,
  d.target_product_id, p.name AS target_product_name,
  d.min_purchase_amount, d.min_quantity, d.start_date, d.end_date,
  d.max_uses, d.current_uses, d.is_active, d.created_by,
  u.name AS created_by_name, d.created_at, d.updated_at
`;

const DISCOUNT_FROM = `
  FROM discount_rules d
  JOIN users u ON u.id = d.created_by
  LEFT JOIN products p ON p.id = d.target_product_id
`;

const DISCOUNT_PATCH_COLUMNS: Readonly<Record<keyof DiscountRulePatch, string>> = {
  name: 'name',
  code: 'code',
  discountType: 'discount_type',
  discountValue: 'discount_value',
  scope: 'scope',
  targetProductId: 'target_product_id',
  minPurchaseAmount: 'min_purchase_amount',
  minQuantity: 'min_quantity',
  startDate: 'start_date',
  endDate: 'end_date',
  maxUses: 'max_uses',
  isActive: 'is_active',
};

function run<T extends QueryResultRow>(sql: string, params: readonly unknown[], client?: PoolClient) {
  return client ? client.query<T>(sql, params as unknown[]) : query<T>(sql, params);
}

/**
 * The eligibility predicate used by billing, in one place:
 * active, inside its date window, and with usage still available. The index on
 * (code, is_active, start_date, end_date) cannot serve this ordering, but the
 * candidate set is small and the atomic consume below is what actually guards
 * the cap.
 */
const APPLICABLE_WHERE = `
  d.is_active = TRUE
  AND CURRENT_DATE BETWEEN d.start_date AND d.end_date
  AND d.current_uses < d.max_uses
`;

export async function listDiscountRules(): Promise<DiscountRuleRow[]> {
  const result = await query<DiscountRuleRow>(
    `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM}
      ORDER BY d.is_active DESC, d.start_date DESC, d.id DESC`,
  );
  return result.rows;
}

export async function listApplicableDiscountRules(
  client?: PoolClient,
): Promise<DiscountRuleRow[]> {
  const result = await run<DiscountRuleRow>(
    `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM}
      WHERE ${APPLICABLE_WHERE}
      ORDER BY d.id ASC`,
    [],
    client,
  );
  return result.rows;
}

export async function findDiscountRuleById(
  id: number,
  client?: PoolClient,
): Promise<DiscountRuleRow | null> {
  const result = await run<DiscountRuleRow>(
    `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM} WHERE d.id = $1`,
    [id],
    client,
  );
  return result.rows[0] ?? null;
}

/** Codes are stored upper-case, so the lookup normalises before comparing. */
export async function findDiscountRuleByCode(
  code: string,
  client?: PoolClient,
): Promise<DiscountRuleRow | null> {
  const result = await run<DiscountRuleRow>(
    `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM} WHERE d.code = UPPER($1) LIMIT 1`,
    [code],
    client,
  );
  return result.rows[0] ?? null;
}

export async function insertDiscountRule(
  input: NewDiscountRuleInput,
  client?: PoolClient,
): Promise<DiscountRuleRow> {
  const result = await run<DiscountRuleRow>(
    `INSERT INTO discount_rules (
       name, code, discount_type, discount_value, scope, target_product_id,
       min_purchase_amount, min_quantity, start_date, end_date, max_uses, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      input.name,
      input.code,
      input.discountType,
      input.discountValue,
      input.scope,
      input.targetProductId,
      input.minPurchaseAmount,
      input.minQuantity,
      input.startDate,
      input.endDate,
      input.maxUses,
      input.createdBy,
    ],
    client,
  );

  const inserted = result.rows[0];
  if (!inserted) throw new Error('Discount rule insert returned no row.');

  const row = await findDiscountRuleById(inserted.id, client);
  if (!row) throw new Error('Discount rule could not be reloaded after insert.');
  return row;
}

export async function updateDiscountRule(
  id: number,
  patch: DiscountRulePatch,
  client?: PoolClient,
): Promise<DiscountRuleRow | null> {
  const { clause, values } = buildUpdateSet(patch, DISCOUNT_PATCH_COLUMNS);
  const updated = await run<QueryResultRow>(
    `UPDATE discount_rules SET ${clause} WHERE id = $${values.length + 1} RETURNING id`,
    [...values, id],
    client,
  );
  if ((updated.rowCount ?? 0) === 0) return null;
  return findDiscountRuleById(id, client);
}

/**
 * Claims one use of a discount.
 *
 * The cap is enforced in the UPDATE's own WHERE clause, not by first reading
 * `current_uses` and then writing it back: two billing runs racing on the last
 * available use would both pass a read-then-write check and overshoot max_uses.
 * A null return means another transaction took the last use, or the rule
 * expired between selection and consumption.
 */
export async function consumeDiscountUse(
  id: number,
  client: PoolClient,
): Promise<{ id: number; current_uses: number; max_uses: number } | null> {
  const result = await client.query<{ id: number; current_uses: number; max_uses: number }>(
    `UPDATE discount_rules
        SET current_uses = current_uses + 1
      WHERE id = $1
        AND is_active = TRUE
        AND current_uses < max_uses
        AND CURRENT_DATE BETWEEN start_date AND end_date
      RETURNING id, current_uses, max_uses`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Clears a rule from every contract that still points at it.
 *
 * Called when the rule can never discount again (retired, expired, exhausted).
 * Issued invoices are untouched — they carry their own discount snapshot — so
 * history stays readable while no future run can pick the rule back up.
 */
export async function detachFromSubscriptions(ruleId: number, client: PoolClient): Promise<number> {
  const result = await client.query(
    `UPDATE subscriptions SET discount_rule_id = NULL, updated_at = NOW() WHERE discount_rule_id = $1`,
    [ruleId],
  );
  return result.rowCount ?? 0;
}
