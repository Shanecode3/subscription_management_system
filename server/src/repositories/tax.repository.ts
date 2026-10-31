import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import { buildUpdateSet } from './update-builder';

export interface TaxRuleRow extends QueryResultRow {
  id: number;
  name: string;
  /** NUMERIC arrives as text; services convert it with toAmount. */
  rate: string;
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
}

export interface NewTaxRuleInput {
  name: string;
  rate: number;
  isActive: boolean;
  isDefault: boolean;
}

export interface TaxRulePatch {
  name?: string;
  rate?: number;
  isActive?: boolean;
  isDefault?: boolean;
}

const TAX_COLUMNS = `id, name, rate, is_active, is_default, created_at`;

const TAX_PATCH_COLUMNS: Readonly<Record<keyof TaxRulePatch, string>> = {
  name: 'name',
  rate: 'rate',
  isActive: 'is_active',
  isDefault: 'is_default',
};

function run<T extends QueryResultRow>(sql: string, params: readonly unknown[], client?: PoolClient) {
  return client ? client.query<T>(sql, params as unknown[]) : query<T>(sql, params);
}

/**
 * `activeOnly` narrows the list for a customer session and for billing, which
 * must never apply a retired rate.
 */
export async function listTaxRules(activeOnly = false): Promise<TaxRuleRow[]> {
  const result = await query<TaxRuleRow>(
    `SELECT ${TAX_COLUMNS}
       FROM tax_rules
      ${activeOnly ? 'WHERE is_active = TRUE' : ''}
      ORDER BY is_default DESC, is_active DESC, name ASC`,
  );
  return result.rows;
}

export async function findTaxRuleById(
  id: number,
  client?: PoolClient,
): Promise<TaxRuleRow | null> {
  const result = await run<TaxRuleRow>(
    `SELECT ${TAX_COLUMNS} FROM tax_rules WHERE id = $1`,
    [id],
    client,
  );
  return result.rows[0] ?? null;
}

/** Case-insensitive lookup backing the friendly duplicate-name message. */
export async function findTaxRuleByName(
  name: string,
  client?: PoolClient,
): Promise<TaxRuleRow | null> {
  const result = await run<TaxRuleRow>(
    `SELECT ${TAX_COLUMNS} FROM tax_rules WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name],
    client,
  );
  return result.rows[0] ?? null;
}

export async function findDefaultTaxRule(client?: PoolClient): Promise<TaxRuleRow | null> {
  const result = await run<TaxRuleRow>(
    `SELECT ${TAX_COLUMNS}
       FROM tax_rules
      WHERE is_default = TRUE AND is_active = TRUE
      LIMIT 1`,
    [],
    client,
  );
  return result.rows[0] ?? null;
}

/**
 * The database allows at most one default (a partial unique index). Moving the
 * flag therefore has to clear the old holder first, in the same transaction.
 */
export async function clearDefaultTaxRule(
  client: PoolClient,
  exceptId?: number,
): Promise<void> {
  await client.query(
    `UPDATE tax_rules
        SET is_default = FALSE
      WHERE is_default = TRUE
        AND ($1::int IS NULL OR id <> $1)`,
    [exceptId ?? null],
  );
}

export async function insertTaxRule(
  input: NewTaxRuleInput,
  client?: PoolClient,
): Promise<TaxRuleRow> {
  const result = await run<TaxRuleRow>(
    `INSERT INTO tax_rules (name, rate, is_active, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING ${TAX_COLUMNS}`,
    [input.name, input.rate, input.isActive, input.isDefault],
    client,
  );

  const row = result.rows[0];
  if (!row) throw new Error('Tax rule insert returned no row.');
  return row;
}

export async function updateTaxRule(
  id: number,
  patch: TaxRulePatch,
  client?: PoolClient,
): Promise<TaxRuleRow | null> {
  const { clause, values } = buildUpdateSet(patch, TAX_PATCH_COLUMNS);
  const result = await run<TaxRuleRow>(
    `UPDATE tax_rules SET ${clause} WHERE id = $${values.length + 1} RETURNING ${TAX_COLUMNS}`,
    [...values, id],
    client,
  );
  return result.rows[0] ?? null;
}
