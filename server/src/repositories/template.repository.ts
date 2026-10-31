import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';

export interface TemplateRow extends QueryResultRow {
  id: number;
  name: string;
  plan_id: number;
  plan_name: string;
  plan_billing_interval: string;
  validity_days: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateLineRow extends QueryResultRow {
  id: number;
  template_id: number;
  product_id: number;
  product_name: string;
  product_type: string;
  variant_id: number | null;
  variant_attribute_name: string | null;
  variant_attribute_value: string | null;
  quantity: number;
  unit_price: string;
}

export interface NewTemplateLineInput {
  productId: number;
  variantId: number | null;
  quantity: number;
  unitPrice: number;
}

/** The plan is joined in so the UI can label a template without a second call. */
const TEMPLATE_COLUMNS = `
  t.id, t.name, t.plan_id, p.name AS plan_name,
  p.billing_interval AS plan_billing_interval,
  t.validity_days, t.notes, t.created_at, t.updated_at
`;

const TEMPLATE_FROM = `
  FROM quotation_templates t
  JOIN subscription_plans p ON p.id = t.plan_id
`;

export async function listTemplates(): Promise<TemplateRow[]> {
  const result = await query<TemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS} ${TEMPLATE_FROM} ORDER BY t.name ASC`,
  );
  return result.rows;
}

export async function findTemplateById(id: number): Promise<TemplateRow | null> {
  const result = await query<TemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS} ${TEMPLATE_FROM} WHERE t.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findTemplateByName(name: string): Promise<TemplateRow | null> {
  const result = await query<TemplateRow>(
    `SELECT ${TEMPLATE_COLUMNS} ${TEMPLATE_FROM} WHERE LOWER(t.name) = LOWER($1) LIMIT 1`,
    [name],
  );
  return result.rows[0] ?? null;
}

/** One query for the lines of every template on screen (no N+1). */
export async function listLinesForTemplates(templateIds: number[]): Promise<TemplateLineRow[]> {
  if (templateIds.length === 0) return [];

  const result = await query<TemplateLineRow>(
    `SELECT l.id, l.template_id, l.product_id, p.name AS product_name,
            p.type AS product_type,
            l.variant_id, v.attribute_name AS variant_attribute_name,
            v.attribute_value AS variant_attribute_value,
            l.quantity, l.unit_price
       FROM quotation_template_lines l
       JOIN products p ON p.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
      WHERE l.template_id = ANY($1::int[])
      ORDER BY l.template_id ASC, l.id ASC`,
    [templateIds],
  );
  return result.rows;
}

export async function insertTemplate(
  input: { name: string; planId: number; validityDays: number; notes: string | null },
  client?: PoolClient,
): Promise<{ id: number }> {
  const sql = `
    INSERT INTO quotation_templates (name, plan_id, validity_days, notes)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `;
  const params = [input.name, input.planId, input.validityDays, input.notes];

  const result = client
    ? await client.query<{ id: number }>(sql, params)
    : await query<{ id: number }>(sql, params);

  const row = result.rows[0];
  if (!row) throw new Error('Template insert returned no row.');
  return row;
}

/**
 * Lines are inserted with a single multi-row INSERT: one round trip, and the
 * whole template is created atomically by the caller's transaction.
 */
export async function insertTemplateLines(
  templateId: number,
  lines: NewTemplateLineInput[],
  client?: PoolClient,
): Promise<void> {
  if (lines.length === 0) return;

  const values: unknown[] = [];
  const tuples = lines.map((line, index) => {
    const base = index * 5;
    values.push(templateId, line.productId, line.variantId, line.quantity, line.unitPrice);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  const sql = `
    INSERT INTO quotation_template_lines (template_id, product_id, variant_id, quantity, unit_price)
    VALUES ${tuples.join(', ')}
  `;

  if (client) {
    await client.query(sql, values);
    return;
  }
  await query(sql, values);
}
