import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool';
import type { ProductType } from '../utils/catalog.validators';
import { buildUpdateSet } from './update-builder';

export interface ProductRow extends QueryResultRow {
  id: number;
  name: string;
  type: ProductType;
  /** NUMERIC arrives as text from `pg`; services convert it to a number. */
  sales_price: string;
  cost_price: string;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface VariantRow extends QueryResultRow {
  id: number;
  product_id: number;
  attribute_name: string;
  attribute_value: string;
  price_extra: string;
  sku: string | null;
  created_at: Date;
}

export interface NewProductInput {
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string | null;
}

export interface ProductPatch {
  name?: string;
  type?: ProductType;
  salesPrice?: number;
  costPrice?: number;
  notes?: string | null;
  isActive?: boolean;
}

export interface NewVariantInput {
  productId: number;
  attributeName: string;
  attributeValue: string;
  priceExtra: number;
  sku: string | null;
}

const PRODUCT_COLUMNS = `id, name, type, sales_price, cost_price, notes, is_active, created_at, updated_at`;
const VARIANT_COLUMNS = `id, product_id, attribute_name, attribute_value, price_extra, sku, created_at`;

/** Whitelist mapping API field names to physical columns. */
const PRODUCT_PATCH_COLUMNS: Readonly<Record<keyof ProductPatch, string>> = {
  name: 'name',
  type: 'type',
  salesPrice: 'sales_price',
  costPrice: 'cost_price',
  notes: 'notes',
  isActive: 'is_active',
};

/** `activeOnly` narrows the catalog for the customer-facing views. */
export async function listProducts(activeOnly = false): Promise<ProductRow[]> {
  const result = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products
      ${activeOnly ? 'WHERE is_active = TRUE' : ''}
      ORDER BY name ASC`,
  );
  return result.rows;
}

export async function findProductById(id: number): Promise<ProductRow | null> {
  const result = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Case-insensitive lookup backing the friendly duplicate-name message. */
export async function findProductByName(name: string): Promise<ProductRow | null> {
  const result = await query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name],
  );
  return result.rows[0] ?? null;
}

export async function insertProduct(
  input: NewProductInput,
  client?: PoolClient,
): Promise<ProductRow> {
  const sql = `
    INSERT INTO products (name, type, sales_price, cost_price, notes)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING ${PRODUCT_COLUMNS}
  `;
  const params = [input.name, input.type, input.salesPrice, input.costPrice, input.notes];

  const result = client
    ? await client.query<ProductRow>(sql, params)
    : await query<ProductRow>(sql, params);

  const row = result.rows[0];
  if (!row) throw new Error('Product insert returned no row.');
  return row;
}

export async function updateProduct(
  id: number,
  patch: ProductPatch,
  client?: PoolClient,
): Promise<ProductRow | null> {
  const { clause, values } = buildUpdateSet(patch, PRODUCT_PATCH_COLUMNS);
  const sql = `UPDATE products SET ${clause} WHERE id = $${values.length + 1} RETURNING ${PRODUCT_COLUMNS}`;
  const params = [...values, id];

  const result = client
    ? await client.query<ProductRow>(sql, params)
    : await query<ProductRow>(sql, params);

  return result.rows[0] ?? null;
}

/** Variants for the given products, in one round trip (no N+1). */
export async function listVariantsForProducts(productIds: number[]): Promise<VariantRow[]> {
  if (productIds.length === 0) return [];

  const result = await query<VariantRow>(
    `SELECT ${VARIANT_COLUMNS}
       FROM product_variants
      WHERE product_id = ANY($1::int[])
      ORDER BY product_id ASC, attribute_name ASC, attribute_value ASC`,
    [productIds],
  );
  return result.rows;
}

export async function findVariantById(id: number): Promise<VariantRow | null> {
  const result = await query<VariantRow>(
    `SELECT ${VARIANT_COLUMNS} FROM product_variants WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Case-insensitive duplicate lookup on the (product, attribute, value) key. */
export async function findVariantByAttributes(
  productId: number,
  attributeName: string,
  attributeValue: string,
): Promise<VariantRow | null> {
  const result = await query<VariantRow>(
    `SELECT ${VARIANT_COLUMNS}
       FROM product_variants
      WHERE product_id = $1
        AND LOWER(attribute_name) = LOWER($2)
        AND LOWER(attribute_value) = LOWER($3)
      LIMIT 1`,
    [productId, attributeName, attributeValue],
  );
  return result.rows[0] ?? null;
}

export async function insertVariant(
  input: NewVariantInput,
  client?: PoolClient,
): Promise<VariantRow> {
  const sql = `
    INSERT INTO product_variants (product_id, attribute_name, attribute_value, price_extra, sku)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING ${VARIANT_COLUMNS}
  `;
  const params = [
    input.productId,
    input.attributeName,
    input.attributeValue,
    input.priceExtra,
    input.sku,
  ];

  const result = client
    ? await client.query<VariantRow>(sql, params)
    : await query<VariantRow>(sql, params);

  const row = result.rows[0];
  if (!row) throw new Error('Variant insert returned no row.');
  return row;
}

export async function deleteVariant(id: number, client?: PoolClient): Promise<boolean> {
  const sql = `DELETE FROM product_variants WHERE id = $1`;
  const result = client ? await client.query(sql, [id]) : await query(sql, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * A variant can be referenced by templates, live contracts and issued
 * invoices. Those columns are `ON DELETE SET NULL`, so a hard delete would
 * silently strip the variant from documents that already described it.
 */
export async function countVariantReferences(
  id: number,
  client?: PoolClient,
): Promise<{ templates: number; subscriptions: number; invoices: number }> {
  const sql = `
    SELECT
      (SELECT COUNT(*)::int FROM quotation_template_lines WHERE variant_id = $1) AS templates,
      (SELECT COUNT(*)::int FROM subscription_lines WHERE variant_id = $1)       AS subscriptions,
      (SELECT COUNT(*)::int FROM invoice_lines WHERE variant_id = $1)            AS invoices`;
  const result = client
    ? await client.query<{ templates: number; subscriptions: number; invoices: number }>(sql, [id])
    : await query<{ templates: number; subscriptions: number; invoices: number }>(sql, [id]);
  return result.rows[0]!;
}
