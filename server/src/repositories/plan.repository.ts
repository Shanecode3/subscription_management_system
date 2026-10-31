import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { BillingInterval } from '../utils/catalog.validators';
import { buildUpdateSet } from './update-builder';

export interface PlanRow extends QueryResultRow {
  id: number;
  name: string;
  price: string;
  billing_interval: BillingInterval;
  min_quantity: number;
  /** DATE columns are parsed to 'YYYY-MM-DD' text in db/pool.ts. */
  available_from: string;
  available_to: string | null;
  auto_close: boolean;
  allow_early_close: boolean;
  allow_pause: boolean;
  allow_renew: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface NewPlanInput {
  name: string;
  price: number;
  billingInterval: BillingInterval;
  minQuantity: number;
  availableFrom: string;
  availableTo: string | null;
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
}

export interface PlanPatch {
  name?: string;
  price?: number;
  billingInterval?: BillingInterval;
  minQuantity?: number;
  availableFrom?: string;
  availableTo?: string | null;
  autoClose?: boolean;
  allowEarlyClose?: boolean;
  allowPause?: boolean;
  allowRenew?: boolean;
  isActive?: boolean;
}

const PLAN_COLUMNS = `
  id, name, price, billing_interval, min_quantity, available_from, available_to,
  auto_close, allow_early_close, allow_pause, allow_renew, is_active,
  created_at, updated_at
`;

const PLAN_PATCH_COLUMNS: Readonly<Record<keyof PlanPatch, string>> = {
  name: 'name',
  price: 'price',
  billingInterval: 'billing_interval',
  minQuantity: 'min_quantity',
  availableFrom: 'available_from',
  availableTo: 'available_to',
  autoClose: 'auto_close',
  allowEarlyClose: 'allow_early_close',
  allowPause: 'allow_pause',
  allowRenew: 'allow_renew',
  isActive: 'is_active',
};

/**
 * `customersOnly` applies the brief's customer rule — only plans that are
 * active *and* on sale today are visible to a customer portal session.
 */
export async function listPlans(customersOnly = false): Promise<PlanRow[]> {
  const result = await query<PlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM subscription_plans
      ${customersOnly
        ? `WHERE is_active = TRUE
             AND available_from <= CURRENT_DATE
             AND (available_to IS NULL OR available_to >= CURRENT_DATE)`
        : ''}
      ORDER BY is_active DESC, price ASC, name ASC`,
  );
  return result.rows;
}

export async function findPlanById(id: number): Promise<PlanRow | null> {
  const result = await query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findPlanByName(name: string): Promise<PlanRow | null> {
  const result = await query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM subscription_plans WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name],
  );
  return result.rows[0] ?? null;
}

export async function insertPlan(input: NewPlanInput, client?: PoolClient): Promise<PlanRow> {
  const sql = `
    INSERT INTO subscription_plans (
      name, price, billing_interval, min_quantity, available_from, available_to,
      auto_close, allow_early_close, allow_pause, allow_renew
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING ${PLAN_COLUMNS}
  `;
  const params = [
    input.name,
    input.price,
    input.billingInterval,
    input.minQuantity,
    input.availableFrom,
    input.availableTo,
    input.autoClose,
    input.allowEarlyClose,
    input.allowPause,
    input.allowRenew,
  ];

  const result = client
    ? await client.query<PlanRow>(sql, params)
    : await query<PlanRow>(sql, params);

  const row = result.rows[0];
  if (!row) throw new Error('Plan insert returned no row.');
  return row;
}

export async function updatePlan(
  id: number,
  patch: PlanPatch,
  client?: PoolClient,
): Promise<PlanRow | null> {
  const { clause, values } = buildUpdateSet(patch, PLAN_PATCH_COLUMNS);
  const sql = `UPDATE subscription_plans SET ${clause} WHERE id = $${values.length + 1} RETURNING ${PLAN_COLUMNS}`;
  const params = [...values, id];

  const result = client
    ? await client.query<PlanRow>(sql, params)
    : await query<PlanRow>(sql, params);

  return result.rows[0] ?? null;
}
