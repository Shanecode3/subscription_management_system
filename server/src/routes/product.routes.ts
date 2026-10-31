import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { asyncHandler, validateBody } from '../middleware/validate.middleware';
import {
  createProductSchema,
  createVariantSchema,
  updateProductSchema,
} from '../utils/catalog.validators';
import { parsePositiveIntParam } from '../utils/params';
import { sendSuccess } from '../utils/response';
import * as productService from '../services/product.service';

export const productRouter = Router();

productRouter.use(authenticate);

/**
 * The catalog. Customers see only active products; internal users see
 * everything, including retired items, so history stays explainable.
 */
productRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const products = await productService.listProducts(req.user!);
    return sendSuccess(res, products);
  }),
);

productRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Product id');
    const product = await productService.getProduct(id, req.user!);
    return sendSuccess(res, product);
  }),
);

/** Admin only — the brief reserves catalog authoring for the Admin role. */
productRouter.post(
  '/',
  requireRole('ADMIN'),
  validateBody(createProductSchema),
  asyncHandler(async (req, res) => {
    const product = await productService.createProduct(req.body, req.user!);
    return sendSuccess(res, product, 201, 'Product created.');
  }),
);

productRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validateBody(updateProductSchema),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Product id');
    const product = await productService.updateProduct(id, req.body, req.user!);
    return sendSuccess(res, product, 200, 'Product updated.');
  }),
);

/**
 * DELETE retires the product (is_active = false) instead of removing the row,
 * so historical invoices keep pointing at real data.
 */
productRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = parsePositiveIntParam(req.params.id, 'Product id');
    const product = await productService.deactivateProduct(id, req.user!);
    return sendSuccess(
      res,
      product,
      200,
      'Product retired from the catalog. Existing invoices are unchanged.',
    );
  }),
);

productRouter.post(
  '/:id/variants',
  requireRole('ADMIN'),
  validateBody(createVariantSchema),
  asyncHandler(async (req, res) => {
    const productId = parsePositiveIntParam(req.params.id, 'Product id');
    const variant = await productService.addVariant(productId, req.body, req.user!);
    return sendSuccess(res, variant, 201, 'Variant added.');
  }),
);

productRouter.delete(
  '/:id/variants/:variantId',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const productId = parsePositiveIntParam(req.params.id, 'Product id');
    const variantId = parsePositiveIntParam(req.params.variantId, 'Variant id');
    await productService.removeVariant(productId, variantId, req.user!);
    return sendSuccess(res, { id: variantId }, 200, 'Variant removed.');
  }),
);
