import { Archive, CalendarClock, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { PlanFormModal } from '../components/catalog/PlanFormModal';
import { AppShell } from '../components/layout/AppShell';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { Switch } from '../components/ui/Switch';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { billingSuffix, formatDate, formatMoney, intervalLabel } from '../lib/format';
import { PLAN_FLAGS, type PlanFlagKey } from '../lib/plan-flags';
import type { BillingInterval, Plan } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';
import { cx } from '../lib/cx';

/**
 * The rail on the left of each card encodes the billing interval — the single
 * fact that most changes how a plan behaves. Colour is information here, not
 * decoration: teal runs from daily to weekly, plum from monthly to yearly.
 */
const INTERVAL_ACCENT: Record<BillingInterval, string> = {
  daily: 'bg-teal-300',
  weekly: 'bg-teal-600',
  monthly: 'bg-plum-400',
  yearly: 'bg-plum-700',
};

export function PlansPage() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, setData, isLoading, error, reload } = useApiResource<Plan[]>('/plans');

  const [formState, setFormState] = useState<{ open: boolean; plan: Plan | null }>({
    open: false,
    plan: null,
  });
  const [pendingFlag, setPendingFlag] = useState<{ planId: number; key: PlanFlagKey } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const plans = data ?? [];

  const replacePlan = (updated: Plan) => {
    setData(plans.map((plan) => (plan.id === updated.id ? updated : plan)));
  };

  const applySavedPlan = (saved: Plan) => {
    setData(
      plans.some((plan) => plan.id === saved.id)
        ? plans.map((plan) => (plan.id === saved.id ? saved : plan))
        : [...plans, saved].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name)),
    );
    setFormState({ open: false, plan: null });
  };

  const toggleFlag = async (plan: Plan, key: PlanFlagKey, next: boolean) => {
    setPendingFlag({ planId: plan.id, key });
    setActionError(null);
    try {
      const result = await apiRequest<Plan>(`/plans/${plan.id}`, {
        method: 'PATCH',
        body: { [key]: next },
        token,
      });
      replacePlan(result.data);
    } catch (toggleError) {
      setActionError(
        toggleError instanceof ApiError
          ? toggleError.message
          : 'Could not change that plan flag. Please try again.',
      );
    } finally {
      setPendingFlag(null);
    }
  };

  const retirePlan = async (plan: Plan) => {
    setBusyId(plan.id);
    setActionError(null);
    try {
      const result = await apiRequest<Plan>(`/plans/${plan.id}`, { method: 'DELETE', token });
      replacePlan(result.data);
    } catch (retireError) {
      setActionError(
        retireError instanceof ApiError
          ? retireError.message
          : 'Could not retire the plan. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const restorePlan = async (plan: Plan) => {
    setBusyId(plan.id);
    setActionError(null);
    try {
      const result = await apiRequest<Plan>(`/plans/${plan.id}`, {
        method: 'PATCH',
        body: { isActive: true },
        token,
      });
      replacePlan(result.data);
    } catch (restoreError) {
      setActionError(
        restoreError instanceof ApiError
          ? restoreError.message
          : 'Could not restore the plan. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Plans"
          description="Billing interval, minimum quantity and lifecycle flags. Flags are stored per plan and govern what a subscriber may pause, renew or close."
          action={
            isAdmin ? (
              <Button className="w-auto" onClick={() => setFormState({ open: true, plan: null })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New plan
              </Button>
            ) : null
          }
        />

        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <div key={card} className="h-72 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Plans could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : plans.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No subscription plans yet"
            description="A plan sets the billing interval and the lifecycle rules a subscription inherits."
            action={
              isAdmin ? (
                <Button
                  className="w-auto"
                  onClick={() => setFormState({ open: true, plan: null })}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New plan
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.id}
                className="relative overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <span
                  className={cx(
                    'absolute inset-y-0 left-0 w-1.5',
                    INTERVAL_ACCENT[plan.billingInterval],
                    !plan.isActive && 'opacity-30',
                  )}
                  aria-hidden="true"
                />

                <div className="flex h-full flex-col p-5 pl-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        className={cx(
                          'text-base font-semibold leading-tight',
                          plan.isActive ? 'text-ink' : 'text-slate-500',
                        )}
                      >
                        {plan.name}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {intervalLabel(plan.billingInterval)} billing · minimum {plan.minQuantity}
                      </p>
                    </div>
                    <Badge tone={plan.isActive ? 'emerald' : 'neutral'}>
                      {plan.isActive ? 'Active' : 'Retired'}
                    </Badge>
                  </div>

                  <p className="mt-4 flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                      {formatMoney(plan.price)}
                    </span>
                    <span className="text-sm text-slate-500">
                      / {billingSuffix(plan.billingInterval)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Available {formatDate(plan.availableFrom)} to {formatDate(plan.availableTo)}
                  </p>

                  <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                    {PLAN_FLAGS.map((flag) => (
                      <div
                        key={flag.key}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{flag.label}</p>
                          <p className="text-xs leading-snug text-slate-500">{flag.description}</p>
                        </div>
                        {isAdmin ? (
                          <Switch
                            label={`${flag.label} for ${plan.name}`}
                            checked={plan[flag.key]}
                            isBusy={pendingFlag?.planId === plan.id && pendingFlag.key === flag.key}
                            onChange={(next) => toggleFlag(plan, flag.key, next)}
                          />
                        ) : (
                          <Badge tone={plan[flag.key] ? 'emerald' : 'neutral'}>
                            {plan[flag.key] ? 'On' : 'Off'}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>

                  {isAdmin ? (
                    <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
                      <Button
                        variant="secondary"
                        className="w-auto px-3 py-2 text-xs"
                        onClick={() => setFormState({ open: true, plan })}
                        disabled={busyId === plan.id}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </Button>

                      {plan.isActive ? (
                        <Button
                          variant="secondary"
                          className="w-auto px-3 py-2 text-xs"
                          onClick={() => retirePlan(plan)}
                          disabled={busyId === plan.id}
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          Retire
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="w-auto px-3 py-2 text-xs"
                          onClick={() => restorePlan(plan)}
                          disabled={busyId === plan.id}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <PlanFormModal
        open={formState.open}
        plan={formState.plan}
        onClose={() => setFormState({ open: false, plan: null })}
        onSaved={applySavedPlan}
      />
    </AppShell>
  );
}
