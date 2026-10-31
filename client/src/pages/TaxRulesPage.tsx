import { Archive, Pencil, Plus, Scale } from 'lucide-react';
import { useState } from 'react';
import { TaxRuleFormModal } from '../components/billing/TaxRuleFormModal';
import { AppShell } from '../components/layout/AppShell';
import { BarList } from '../components/charts/BarList';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDateTime } from '../lib/format';
import type { TaxRule } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

/**
 * Admin-configured tax rates. The default is what a contract pays unless it has
 * been assigned its own rate, and the rate is copied onto the invoice line at
 * issue time so history never changes under a customer.
 */
export function TaxRulesPage() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, setData, isLoading, error, reload } = useApiResource<TaxRule[]>('/tax-rules');

  const [formState, setFormState] = useState<{ open: boolean; rule: TaxRule | null }>({
    open: false,
    rule: null,
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rules = data ?? [];
  const defaultRate = rules.find((rule) => rule.isDefault)?.rate ?? null;

  const applySaved = (saved: TaxRule) => {
    const exists = rules.some((rule) => rule.id === saved.id);
    const next = exists
      ? rules.map((rule) => {
          if (rule.id === saved.id) return saved;
          // The server moves the default flag, so mirror that locally rather
          // than refetching a list that has already been answered.
          return saved.isDefault ? { ...rule, isDefault: false } : rule;
        })
      : [...rules, saved];

    setData(next.sort((left, right) => left.rate - right.rate || left.name.localeCompare(right.name)));
    setFormState({ open: false, rule: null });
  };

  const retireRule = async (rule: TaxRule) => {
    setBusyId(rule.id);
    setActionError(null);
    try {
      const result = await apiRequest<TaxRule>(`/tax-rules/${rule.id}`, { method: 'DELETE', token });
      setData(rules.map((item) => (item.id === rule.id ? result.data : item)));
    } catch (retireError) {
      setActionError(
        retireError instanceof ApiError
          ? retireError.message
          : 'Could not retire that tax rule. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Tax rules"
          description="Rates applied automatically when an invoice is generated. One rule is the default for contracts without their own rate."
          action={
            isAdmin ? (
              <Button className="w-auto" onClick={() => setFormState({ open: true, rule: null })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New tax rule
              </Button>
            ) : null
          }
        />

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Tax rules could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No tax rules yet"
            description="Create a rate and mark one as the default. Billing copies the rate onto each invoice line, so changing it later never rewrites an issued invoice."
            action={
              isAdmin ? (
                <Button className="w-auto" onClick={() => setFormState({ open: true, rule: null })}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New tax rule
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <section className="card px-4 py-3.5" aria-label="Tax rates at a glance">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Rates at a glance</h2>
                  <p className="text-xs text-slate-500">
                    Every rate on one scale, so the spread is readable before the table is
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Default{' '}
                  <span className="font-semibold tabular-nums text-ink">
                    {defaultRate === null ? 'not set' : `${defaultRate}%`}
                  </span>
                </p>
              </div>
              <div className="mt-3">
                <BarList
                  ariaLabel="Tax rates by rule"
                  labelWidth="w-[9rem]"
                  items={rules.map((rule) => ({
                    key: String(rule.id),
                    label: rule.name,
                    value: rule.rate,
                    display: `${rule.rate}%`,
                    color: rule.isDefault
                      ? 'bg-plum-600'
                      : rule.isActive
                        ? 'bg-teal-600'
                        : 'bg-slate-300',
                  }))}
                />
              </div>
            </section>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-semibold text-slate-500">
                      <th scope="col" className="px-5 py-2.5">Rate</th>
                      <th scope="col" className="px-3 py-2.5">Status</th>
                      <th scope="col" className="px-3 py-2.5">Applied when</th>
                      <th scope="col" className="px-3 py-2.5">Created</th>
                      {isAdmin ? (
                        <th scope="col" className="px-5 py-2.5 text-right">Actions</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rules.map((rule) => (
                      <tr key={rule.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3">
                          <p className="font-semibold text-ink">{rule.name}</p>
                          <p className="text-xs text-slate-500">{rule.rate}% of the taxable amount</p>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={rule.isActive ? 'emerald' : 'neutral'}>
                              {rule.isActive ? 'Active' : 'Retired'}
                            </Badge>
                            {rule.isDefault ? <Badge tone="plum">Default</Badge> : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {rule.isDefault
                            ? 'Every contract without its own rate'
                            : 'Only contracts assigned this rate'}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {formatDateTime(rule.createdAt)}
                        </td>
                        {isAdmin ? (
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="secondary"
                                className="w-auto px-3 py-1.5 text-xs"
                                onClick={() => setFormState({ open: true, rule })}
                                disabled={busyId === rule.id}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                Edit
                              </Button>
                              {rule.isActive ? (
                                <Button
                                  variant="secondary"
                                  className="w-auto px-3 py-1.5 text-xs"
                                  onClick={() => retireRule(rule)}
                                  disabled={busyId === rule.id}
                                  isLoading={busyId === rule.id}
                                >
                                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                                  Retire
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
          </div>
          </>
        )}

        <p className="text-xs leading-relaxed text-slate-500">
          Retired rates stay in the database because invoice lines reference them — deleting a rate
          would make an already-issued invoice impossible to explain.
        </p>
      </div>

      <TaxRuleFormModal
        open={formState.open}
        rule={formState.rule}
        onClose={() => setFormState({ open: false, rule: null })}
        onSaved={applySaved}
      />
    </AppShell>
  );
}
