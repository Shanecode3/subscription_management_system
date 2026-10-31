import { Archive, Package, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ProductFormModal } from '../components/catalog/ProductFormModal';
import { VariantFormModal } from '../components/catalog/VariantFormModal';
import { AppShell } from '../components/layout/AppShell';
import { Alert } from '../components/ui/Alert';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { PageHeader } from '../components/ui/PageHeader';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatMoney } from '../lib/format';
import type { Product, ProductType, ProductVariant } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

const TYPE_TONE: Record<ProductType, BadgeTone> = {
  Software: 'plum',
  Service: 'teal',
  'Add-on': 'amber',
};

function sortProducts(products: Product[]): Product[] {
  return [...products].sort((a, b) => a.name.localeCompare(b.name));
}

export function ProductsPage() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, setData, isLoading, error, reload } = useApiResource<Product[]>('/products');

  const [search, setSearch] = useState('');
  const [productModal, setProductModal] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  });
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const products = data ?? [];

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return products;

    return products.filter((product) => {
      const haystack = [
        product.name,
        product.type,
        product.notes ?? '',
        ...product.variants.map((variant) => `${variant.attributeName} ${variant.attributeValue}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [products, search]);

  const applyProduct = (saved: Product) => {
    setData(
      sortProducts(
        products.some((product) => product.id === saved.id)
          ? products.map((product) => (product.id === saved.id ? saved : product))
          : [...products, saved],
      ),
    );
    setProductModal({ open: false, product: null });
  };

  const applyVariant = (productId: number, variant: ProductVariant) => {
    setData(
      products.map((product) =>
        product.id === productId
          ? { ...product, variants: [...product.variants, variant] }
          : product,
      ),
    );
    setVariantProduct(null);
  };

  const mutate = async (product: Product, request: () => Promise<Product>) => {
    setBusyId(product.id);
    setActionError(null);
    try {
      const updated = await request();
      setData(products.map((item) => (item.id === updated.id ? updated : item)));
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof ApiError
          ? actionFailure.message
          : 'Could not update the product. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const retireProduct = (product: Product) =>
    mutate(product, async () => {
      const result = await apiRequest<Product>(`/products/${product.id}`, {
        method: 'DELETE',
        token,
      });
      return result.data;
    });

  const restoreProduct = (product: Product) =>
    mutate(product, async () => {
      const result = await apiRequest<Product>(`/products/${product.id}`, {
        method: 'PATCH',
        body: { isActive: true },
        token,
      });
      return result.data;
    });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Products"
          description="The catalog every quotation line is built from. A variant adds a surcharge to the base price — the Odoo brand, for example, adds $560."
          action={
            isAdmin ? (
              <Button
                className="w-auto"
                onClick={() => setProductModal({ open: true, product: null })}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New product
              </Button>
            ) : null
          }
        />

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="relative w-full sm:w-80">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, type or variant"
                aria-label="Search products"
                className="field-input h-10 pl-9"
              />
            </div>
            <p className="text-xs text-slate-500">
              {visibleProducts.length} of {products.length} products
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : error ? (
            <div className="space-y-3 p-4">
              <Alert tone="error" title="Products could not be loaded">
                {error}
              </Alert>
              <Button variant="secondary" className="w-auto" onClick={reload}>
                Try again
              </Button>
            </div>
          ) : products.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Package}
                title="No products yet"
                description="Add the first product to start building quotation templates and subscriptions."
                action={
                  isAdmin ? (
                    <Button
                      className="w-auto"
                      onClick={() => setProductModal({ open: true, product: null })}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      New product
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : visibleProducts.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              No product matches “{search.trim()}”. Try a different word.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold text-slate-500">
                    <th scope="col" className="px-4 py-2.5">
                      Product
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Sales price
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Cost price
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Variants
                    </th>
                    {isAdmin ? (
                      <th scope="col" className="px-4 py-2.5 text-right">
                        Actions
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleProducts.map((product) => (
                    <tr
                      key={product.id}
                      className={product.isActive ? undefined : 'bg-slate-50/60'}
                    >
                      <td className="max-w-xs px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              product.isActive
                                ? 'font-semibold text-ink'
                                : 'font-semibold text-slate-500'
                            }
                          >
                            {product.name}
                          </span>
                          {product.isActive ? null : <Badge tone="neutral">Retired</Badge>}
                        </div>
                        {product.notes ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                            {product.notes}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-4 py-3">
                        <Badge tone={TYPE_TONE[product.type]}>{product.type}</Badge>
                      </td>

                      <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                        {formatMoney(product.salesPrice)}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatMoney(product.costPrice)}
                      </td>

                      <td className="px-4 py-3">
                        {product.variants.length === 0 ? (
                          <span className="text-xs text-slate-400">No variants</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {product.variants.map((variant) => (
                              <li
                                key={variant.id}
                                className="flex items-baseline gap-2 text-xs tabular-nums"
                              >
                                <span className="font-medium text-ink">
                                  {variant.attributeName}: {variant.attributeValue}
                                </span>
                                {variant.priceExtra > 0 ? (
                                  <span className="text-teal-700">
                                    +{formatMoney(variant.priceExtra)}
                                  </span>
                                ) : null}
                                <span className="text-slate-500">{formatMoney(variant.price)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>

                      {isAdmin ? (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              label={`Add a variant to ${product.name}`}
                              onClick={() => setVariantProduct(product)}
                              disabled={busyId === product.id}
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={`Edit ${product.name}`}
                              onClick={() => setProductModal({ open: true, product })}
                              disabled={busyId === product.id}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </IconButton>
                            {product.isActive ? (
                              <IconButton
                                label={`Retire ${product.name}`}
                                tone="danger"
                                onClick={() => retireProduct(product)}
                                disabled={busyId === product.id}
                              >
                                <Archive className="h-4 w-4" aria-hidden="true" />
                              </IconButton>
                            ) : (
                              <IconButton
                                label={`Restore ${product.name}`}
                                onClick={() => restoreProduct(product)}
                                disabled={busyId === product.id}
                              >
                                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                              </IconButton>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ProductFormModal
        open={productModal.open}
        product={productModal.product}
        onClose={() => setProductModal({ open: false, product: null })}
        onSaved={applyProduct}
      />

      <VariantFormModal
        open={variantProduct !== null}
        product={variantProduct}
        onClose={() => setVariantProduct(null)}
        onSaved={applyVariant}
      />
    </AppShell>
  );
}
