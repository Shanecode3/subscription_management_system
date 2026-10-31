import { withTransaction } from '../db/pool';
import { recordAuditEvent } from '../repositories/audit.repository';
import * as productRepository from '../repositories/product.repository';
import type {
  ProductPatch,
  ProductRow,
  VariantRow,
} from '../repositories/product.repository';
import type {
  CreateProductInput,
  CreateVariantInput,
  ProductType,
  UpdateProductInput,
} from '../utils/catalog.validators';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { toAmount } from '../utils/money';
import type { Requester } from './requester';

export interface ProductVariantDto {
  id: number;
  attributeName: string;
  attributeValue: string;
  priceExtra: number;
  /** Base sales price plus this variant's surcharge — the price a line uses. */
  price: number;
  sku: string | null;
}

export interface ProductDto {
  id: number;
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  isActive: boolean;
  variants: ProductVariantDto[];
  createdAt: string;
  updatedAt: string;
}

function assertAdmin(requester: Requester, message: string): void {
  if (requester.role !== 'ADMIN') {
    throw new ForbiddenError(message);
  }
}

function normalizeNotes(notes: string | null | undefined): string | null {
  if (notes === null || notes === undefined) return null;
  const trimmed = notes.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toVariantDto(row: VariantRow, baseSalesPrice: number): ProductVariantDto {
  const priceExtra = toAmount(row.price_extra);
  return {
    id: row.id,
    attributeName: row.attribute_name,
    attributeValue: row.attribute_value,
    priceExtra,
    price: toAmount(baseSalesPrice + priceExtra),
    sku: row.sku,
  };
}

/**
 * Cost price is internal margin data. The catalogue screens already hide it
 * from customers, so the API must not hand it out either: a customer receives
 * zero rather than the company's buying price.
 */
export function toProductDto(
  product: ProductRow,
  variants: VariantRow[],
  includeCost = true,
): ProductDto {
  const salesPrice = toAmount(product.sales_price);
  return {
    id: product.id,
    name: product.name,
    type: product.type,
    salesPrice,
    costPrice: includeCost ? toAmount(product.cost_price) : 0,
    notes: product.notes,
    isActive: product.is_active,
    variants: variants.map((variant) => toVariantDto(variant, salesPrice)),
    createdAt: product.created_at.toISOString(),
    updatedAt: product.updated_at.toISOString(),
  };
}

/** Batch-loads variants for the given products so a list needs two queries, not N+1. */
export async function loadProductsWithVariants(
  products: ProductRow[],
  includeCost = true,
): Promise<ProductDto[]> {
  const variants = await productRepository.listVariantsForProducts(products.map((p) => p.id));

  const byProduct = new Map<number, VariantRow[]>();
  for (const variant of variants) {
    const bucket = byProduct.get(variant.product_id);
    if (bucket) bucket.push(variant);
    else byProduct.set(variant.product_id, [variant]);
  }

  return products.map((product) =>
    toProductDto(product, byProduct.get(product.id) ?? [], includeCost),
  );
}

export async function listProducts(requester: Requester): Promise<ProductDto[]> {
  const rows = await productRepository.listProducts(requester.role === 'CUSTOMER');
  return loadProductsWithVariants(rows, requester.role !== 'CUSTOMER');
}

export async function getProduct(id: number, requester: Requester): Promise<ProductDto> {
  const product = await productRepository.findProductById(id);
  if (!product || (requester.role === 'CUSTOMER' && !product.is_active)) {
    throw new NotFoundError('That product does not exist.');
  }
  const [dto] = await loadProductsWithVariants([product], requester.role !== 'CUSTOMER');
  return dto!;
}

export async function createProduct(
  input: CreateProductInput,
  requester: Requester,
): Promise<ProductDto> {
  assertAdmin(requester, 'Only an Admin can add products to the catalog.');

  const duplicate = await productRepository.findProductByName(input.name);
  if (duplicate) {
    throw new ConflictError(`A product named "${input.name}" already exists.`, [
      { field: 'name', message: 'Product names must be unique — choose a different name.' },
    ]);
  }

  return withTransaction(async (client) => {
    const created = await productRepository.insertProduct(
      {
        name: input.name,
        type: input.type,
        salesPrice: input.salesPrice,
        costPrice: input.costPrice ?? 0,
        notes: normalizeNotes(input.notes),
      },
      client,
    );

    await recordAuditEvent(
      {
        entityType: 'PRODUCT',
        entityId: created.id,
        action: 'PRODUCT_CREATED',
        performedBy: requester.id,
        details: { name: created.name, type: created.type, salesPrice: created.sales_price },
      },
      client,
    );

    return toProductDto(created, []);
  });
}

export async function updateProduct(
  id: number,
  input: UpdateProductInput,
  requester: Requester,
): Promise<ProductDto> {
  assertAdmin(requester, 'Only an Admin can edit products.');

  const existing = await productRepository.findProductById(id);
  if (!existing) {
    throw new NotFoundError('That product does not exist.');
  }

  if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await productRepository.findProductByName(input.name);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError(`A product named "${input.name}" already exists.`, [
        { field: 'name', message: 'Product names must be unique — choose a different name.' },
      ]);
    }
  }

  const patch: ProductPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.salesPrice !== undefined) patch.salesPrice = input.salesPrice;
  if (input.costPrice !== undefined) patch.costPrice = input.costPrice;
  if (input.notes !== undefined) patch.notes = normalizeNotes(input.notes);
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  return withTransaction(async (client) => {
    const updated = await productRepository.updateProduct(id, patch, client);
    if (!updated) throw new NotFoundError('That product does not exist.');

    await recordAuditEvent(
      {
        entityType: 'PRODUCT',
        entityId: updated.id,
        action: 'PRODUCT_UPDATED',
        performedBy: requester.id,
        details: { changes: patch },
      },
      client,
    );

    const variants = await productRepository.listVariantsForProducts([updated.id]);
    return toProductDto(updated, variants);
  });
}

/**
 * Removes a product from the active catalog without touching history.
 *
 * A hard DELETE would be refused by the RESTRICT foreign keys once the product
 * appears on an invoice, and would silently rewrite quotations if those keys
 * were relaxed. Deactivating keeps every historical invoice reconstructable.
 */
export async function deactivateProduct(id: number, requester: Requester): Promise<ProductDto> {
  assertAdmin(requester, 'Only an Admin can remove products from the catalog.');

  const existing = await productRepository.findProductById(id);
  if (!existing) {
    throw new NotFoundError('That product does not exist.');
  }

  return withTransaction(async (client) => {
    const updated = await productRepository.updateProduct(id, { isActive: false }, client);
    if (!updated) throw new NotFoundError('That product does not exist.');

    await recordAuditEvent(
      {
        entityType: 'PRODUCT',
        entityId: updated.id,
        action: 'PRODUCT_DEACTIVATED',
        performedBy: requester.id,
        details: { name: updated.name },
      },
      client,
    );

    const variants = await productRepository.listVariantsForProducts([updated.id]);
    return toProductDto(updated, variants);
  });
}

export async function addVariant(
  productId: number,
  input: CreateVariantInput,
  requester: Requester,
): Promise<{ productId: number; variant: ProductVariantDto }> {
  assertAdmin(requester, 'Only an Admin can add product variants.');

  const product = await productRepository.findProductById(productId);
  if (!product) {
    throw new NotFoundError('That product does not exist.');
  }

  const duplicate = await productRepository.findVariantByAttributes(
    productId,
    input.attributeName,
    input.attributeValue,
  );
  if (duplicate) {
    throw new ConflictError(
      `This product already has a "${input.attributeName}: ${input.attributeValue}" variant.`,
      [
        {
          field: 'attributeValue',
          message: 'This attribute value already exists for the product.',
        },
      ],
    );
  }

  return withTransaction(async (client) => {
    const created = await productRepository.insertVariant(
      {
        productId,
        attributeName: input.attributeName,
        attributeValue: input.attributeValue,
        priceExtra: input.priceExtra,
        sku: input.sku ?? null,
      },
      client,
    );

    await recordAuditEvent(
      {
        entityType: 'PRODUCT_VARIANT',
        entityId: created.id,
        action: 'VARIANT_ADDED',
        performedBy: requester.id,
        details: {
          productId,
          attribute: `${created.attribute_name}: ${created.attribute_value}`,
          priceExtra: created.price_extra,
        },
      },
      client,
    );

    return {
      productId,
      variant: toVariantDto(created, toAmount(product.sales_price)),
    };
  });
}

export async function removeVariant(
  productId: number,
  variantId: number,
  requester: Requester,
): Promise<void> {
  assertAdmin(requester, 'Only an Admin can remove product variants.');

  const variant = await productRepository.findVariantById(variantId);
  if (!variant || variant.product_id !== productId) {
    throw new NotFoundError('That variant does not exist on this product.');
  }

  await withTransaction(async (client) => {
    const refs = await productRepository.countVariantReferences(variantId, client);
    if (refs.templates + refs.subscriptions + refs.invoices > 0) {
      throw new ConflictError(
        'That variant is used by an existing quotation template, subscription or invoice, so it cannot be deleted. Retire the product instead.',
        [{ field: 'variantId', message: 'This variant is already referenced by documents.' }],
      );
    }

    await productRepository.deleteVariant(variantId, client);
    await recordAuditEvent(
      {
        entityType: 'PRODUCT_VARIANT',
        entityId: variantId,
        action: 'VARIANT_REMOVED',
        performedBy: requester.id,
        details: {
          productId,
          attribute: `${variant.attribute_name}: ${variant.attribute_value}`,
        },
      },
      client,
    );
  });
}

/**
 * Resolves a product+variant pair for a quotation line, enforcing the rule that
 * a variant only belongs to the product it was defined on. Returns the price a
 * line should use when the caller did not override it.
 */
export async function resolvePricedLine(
  productId: number,
  variantId: number | null,
): Promise<{ product: ProductRow; variant: VariantRow | null; unitPrice: number }> {
  const product = await productRepository.findProductById(productId);
  if (!product) {
    throw new ValidationError(`Product #${productId} does not exist.`, [
      { field: 'lines', message: `Product #${productId} does not exist.` },
    ]);
  }
  if (!product.is_active) {
    throw new ValidationError(`"${product.name}" is no longer available.`, [
      { field: 'lines', message: `"${product.name}" is inactive and cannot be offered.` },
    ]);
  }

  let variant: VariantRow | null = null;
  if (variantId !== null) {
    variant = await productRepository.findVariantById(variantId);
    if (!variant || variant.product_id !== productId) {
      throw new ValidationError(
        `Variant #${variantId} does not belong to "${product.name}".`,
        [{ field: 'lines', message: `Variant #${variantId} does not belong to "${product.name}".` }],
      );
    }
  }

  const unitPrice = toAmount(toAmount(product.sales_price) + toAmount(variant?.price_extra));
  return { product, variant, unitPrice };
}
