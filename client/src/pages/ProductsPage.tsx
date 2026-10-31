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
import { cx } from '../lib/cx';
import { formatMoney } from '../lib/format';
import type { Product, ProductType, ProductVariant } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

const TYPE_TONE: Record<ProductType, BadgeTone> = {
  Software: 'plum',
  Service: 'teal',
  'Add-on': 'amber',
};

/**
 * The rail on the left edge repeats the type badge in colour, so a wall of
 * cards can be scanned by category without reading every label. It carries the
 * same tone as the badge — the colour is the type, not decoration.
 */
const TYPE_ACCENT: Record<ProductType, string> = {
  Software: 'bg-plum-600',
  Service: 'bg-teal-600',
  'Add-on': 'bg-amber-400',
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

        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
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
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <div key={card} className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Products could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : products.length === 0 ? (
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
        ) : visibleProducts.length === 0 ? (
          <p className="card px-4 py-10 text-center text-sm text-slate-500">
            No product matches “{search.trim()}”. Try a different word.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visibleProducts.map((product) => (
              <article
                key={product.id}
                className="relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <span
                  className={cx(
                    'absolute inset-y-0 left-0 w-1.5',
                    TYPE_ACCENT[product.type],
                    !product.isActive && 'opacity-30',
                  )}
                  aria-hidden="true"
                />

                <div className="flex h-full flex-col p-5 pl-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2
                      className={cx(
                        'text-base font-semibold leading-tight',
                        product.isActive ? 'text-ink' : 'text-slate-500',
                      )}
                    >
                      {product.name}
                    </h2>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge tone={TYPE_TONE[product.type]}>{product.type}</Badge>
                      {product.isActive ? null : <Badge tone="neutral">Retired</Badge>}
                    </div>
                  </div>

                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                      {formatMoney(product.salesPrice)}
                    </span>
                    <span className="text-sm text-slate-500">/ unit</span>
                  </p>

                  {/* Cost price is internal margin data, so customers never see it. */}
                  {isAdmin ? (
                    <p className="mt-1 text-xs tabular-nums text-slate-500">
                      Cost {formatMoney(product.costPrice)} · margin{' '}
                      {formatMoney(product.salesPrice - product.costPrice)}
                    </p>
                  ) : null}

                  {product.notes ? (
                    <p className="mt-3 line-clamp-2 text-sm leading-snug text-slate-600">
                      {product.notes}
                    </p>
                  ) : null}

                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium text-slate-500">
                      {product.variants.length === 0
                        ? 'No variants'
                        : `Variants (${product.variants.length})`}
                    </p>
                    {product.variants.length > 0 ? (
                      <ul className="mt-2 space-y-1.5">
                        {product.variants.map((variant) => (
                          <li
                            key={variant.id}
                            className="flex items-baseline justify-between gap-3 text-xs"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium text-ink">
                                {variant.attributeName}: {variant.attributeValue}
                              </span>
                              {variant.priceExtra > 0 ? (
                                <span className="ml-1.5 text-teal-700">
                                  +{formatMoney(variant.priceExtra)}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-slate-500">
                              {formatMoney(variant.price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {isAdmin ? (
                    <div className="mt-auto flex items-center justify-end gap-1 border-t border-slate-100 pt-4">
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
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
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
