import { Archive, BadgePercent, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { DiscountFormModal } from '../components/billing/DiscountFormModal';
import { AppShell } from '../components/layout/AppShell';
import { BarList } from '../components/charts/BarList';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDate, formatMoney } from '../lib/format';
import { DISCOUNT_STANDING_TONE } from '../lib/invoice-status';
import type { DiscountRule, Product } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

function ruleValue(rule: DiscountRule): string {
  return rule.discountType === 'percentage'
    ? `${rule.discountValue}% off`
    : `${formatMoney(rule.discountValue)} off`;
}

/**
 * Discount rules are authored by an Admin only; Staff can read the list to know
 * what is live. The server enforces the same rule, so hiding the buttons is a
 * courtesy rather than the security boundary.
 */
export function DiscountsPage() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, setData, isLoading, error, reload } = useApiResource<DiscountRule[]>(
    '/discount-rules',
  );
  const { data: productData } = useApiResource<Product[]>('/products');

  const [formState, setFormState] = useState<{ open: boolean; rule: DiscountRule | null }>({
    open: false,
    rule: null,
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rules = data ?? [];
  const products = productData ?? [];

  const activeRules = rules.filter((rule) => rule.isActive).length;
  const headroomItems = [...rules]
    .sort((left, right) => right.usesRemaining - left.usesRemaining)
    .map((rule) => ({
      key: String(rule.id),
      label: rule.code,
      value: rule.usesRemaining,
      display: `${rule.usesRemaining.toLocaleString()} left`,
      color: rule.isActive ? 'bg-teal-500' : 'bg-slate-300',
    }));

  const applySaved = (saved: DiscountRule) => {
    setData(
      rules.some((rule) => rule.id === saved.id)
        ? rules.map((rule) => (rule.id === saved.id ? saved : rule))
        : [saved, ...rules],
    );
    setFormState({ open: false, rule: null });
  };

  const retireRule = async (rule: DiscountRule) => {
    setBusyId(rule.id);
    setActionError(null);
    try {
      const result = await apiRequest<DiscountRule>(`/discount-rules/${rule.id}`, {
        method: 'DELETE',
        token,
      });
      setData(rules.map((item) => (item.id === rule.id ? result.data : item)));
    } catch (retireError) {
      setActionError(
        retireError instanceof ApiError
          ? retireError.message
          : 'Could not retire that discount. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const restoreRule = async (rule: DiscountRule) => {
    setBusyId(rule.id);
    setActionError(null);
    try {
      const result = await apiRequest<DiscountRule>(`/discount-rules/${rule.id}`, {
        method: 'PATCH',
        body: { isActive: true },
        token,
      });
      setData(rules.map((item) => (item.id === rule.id ? result.data : item)));
    } catch (restoreError) {
      setActionError(
        restoreError instanceof ApiError
          ? restoreError.message
          : 'Could not restore that discount. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Discounts"
          description="Automatic rules the billing engine evaluates on every invoice. A rule stops applying by itself at its end date or once its usage limit is reached."
          action={
            isAdmin ? (
              <Button className="w-auto" onClick={() => setFormState({ open: true, rule: null })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New discount
              </Button>
            ) : null
          }
        />

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {isLoading ? (
          <div className="space-y-3">
            <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Discounts could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={BadgePercent}
            title="No discount rules yet"
            description="A rule can take a percentage or a fixed amount off the whole subscription or one product, within a date window and a usage limit."
            action={
              isAdmin ? (
                <Button
                  className="w-auto"
                  onClick={() => setFormState({ open: true, rule: null })}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New discount
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <section className="card px-4 py-3.5" aria-label="Discount headroom">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Headroom by rule</h2>
                  <p className="text-xs text-slate-500">
                    Uses left before each rule stops applying on its own
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {activeRules} active of {rules.length}
                </p>
              </div>
              <div className="mt-3">
                <BarList
                  ariaLabel="Uses remaining by discount rule"
                  labelWidth="w-[7.5rem]"
                  items={headroomItems}
                  empty={<p className="text-xs text-slate-500">No redemption limit is set.</p>}
                />
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              {rules.map((rule) => {
                const usedShare = Math.min(rule.currentUses / rule.maxUses, 1) * 100;

                return (
                  <article key={rule.id} className="card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-plum-50 px-2 py-0.5 font-mono text-xs font-semibold tracking-wide text-plum-800 ring-1 ring-inset ring-plum-100">
                            {rule.code}
                          </span>
                          <Badge tone={DISCOUNT_STANDING_TONE[rule.standing]}>{rule.standing}</Badge>
                        </div>
                        <h2 className="mt-2 text-base font-semibold leading-tight text-ink">
                          {rule.name}
                        </h2>
                      </div>
                      <p className="shrink-0 rounded-lg bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-800 ring-1 ring-inset ring-teal-100">
                        {ruleValue(rule)}
                      </p>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Applies to</dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          {rule.scope === 'whole_subscription'
                            ? 'Whole subscription'
                            : (rule.targetProductName ?? 'One product')}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Runs</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-ink">
                          {formatDate(rule.startDate)} → {formatDate(rule.endDate)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Thresholds</dt>
                        <dd className="mt-0.5 font-medium text-ink">
                          {rule.minPurchaseAmount > 0
                            ? `Min ${formatMoney(rule.minPurchaseAmount)}`
                            : 'No minimum spend'}
                          {rule.minQuantity > 0 ? ` · ${rule.minQuantity}+ units` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Created by</dt>
                        <dd className="mt-0.5 font-medium text-ink">{rule.createdByName}</dd>
                      </div>
                    </dl>

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>
                          {rule.currentUses} of {rule.maxUses} uses
                        </span>
                        <span>{rule.usesRemaining} left</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={
                            usedShare >= 100 ? 'h-full rounded-full bg-amber-500' : 'h-full rounded-full bg-teal-500'
                          }
                          style={{ width: `${usedShare}%` }}
                        />
                      </div>
                    </div>

                    {isAdmin ? (
                      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
                        <Button
                          variant="secondary"
                          className="w-auto px-3 py-2 text-xs"
                          onClick={() => setFormState({ open: true, rule })}
                          disabled={busyId === rule.id}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit
                        </Button>
                        {rule.isActive ? (
                          <Button
                            variant="secondary"
                            className="w-auto px-3 py-2 text-xs"
                            onClick={() => retireRule(rule)}
                            disabled={busyId === rule.id}
                            isLoading={busyId === rule.id}
                          >
                            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                            Retire
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            className="w-auto px-3 py-2 text-xs"
                            onClick={() => restoreRule(rule)}
                            disabled={busyId === rule.id}
                            isLoading={busyId === rule.id}
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            Restore
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      <DiscountFormModal
        open={formState.open}
        rule={formState.rule}
        products={products}
        onClose={() => setFormState({ open: false, rule: null })}
        onSaved={applySaved}
      />
    </AppShell>
  );
}
