import { Archive, CalendarClock, Check, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { PlanFormModal } from '../components/catalog/PlanFormModal';
import { AppShell } from '../components/layout/AppShell';
import { BarList } from '../components/charts/BarList';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { Switch } from '../components/ui/Switch';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { billingSuffix, formatDate, formatMoney, todayIso } from '../lib/format';
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

const INTERVALS_PER_YEAR: Record<BillingInterval, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  yearly: 1,
};

/** The three things a subscriber is allowed to do to their own contract. */
const SELF_SERVICE: { key: PlanFlagKey; verb: string }[] = [
  { key: 'allowPause', verb: 'pause and resume' },
  { key: 'allowRenew', verb: 'renew' },
  { key: 'allowEarlyClose', verb: 'close early' },
];

function sentenceList(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

/**
 * Reads a plan's stored columns as the plain sentences a buyer needs. Every
 * line is derived from the row, so there is no free-text description that can
 * drift away from the price and the lifecycle switches shown underneath it.
 */
function planOffers(plan: Plan): string[] {
  const unit = billingSuffix(plan.billingInterval);
  const minimum = plan.minQuantity === 1 ? '1 unit' : `${plan.minQuantity} units`;
  const today = todayIso();

  const offers = [
    `Charged ${formatMoney(plan.price)} per ${unit}, ${minimum} at a time`,
    `About ${formatMoney(plan.price * INTERVALS_PER_YEAR[plan.billingInterval] * plan.minQuantity)} a year at the minimum quantity`,
  ];

  const closesOn = plan.availableTo ? formatDate(plan.availableTo) : null;
  if (plan.availableFrom && today < plan.availableFrom) {
    offers.push(
      `Orders open on ${formatDate(plan.availableFrom)}${closesOn ? ` and close on ${closesOn}` : ''}`,
    );
  } else if (plan.availableTo && today > plan.availableTo) {
    offers.push(`No longer orderable — the window closed on ${closesOn}`);
  } else {
    offers.push(`Open to order now${closesOn ? ` until ${closesOn}` : ' with no end date'}`);
  }

  const selfService = SELF_SERVICE.filter((action) => plan[action.key]).map(
    (action) => action.verb,
  );
  offers.push(
    selfService.length > 0
      ? `Subscribers can ${sentenceList(selfService)} themselves`
      : 'Subscribers cannot pause, renew or close it themselves',
  );

  offers.push(
    plan.autoClose
      ? 'Closes by itself on its expiry date'
      : 'Stays open past expiry until it is closed manually',
  );

  return offers;
}

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
          <>
            <section className="card px-4 py-3.5" aria-label="Monthly cost comparison">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Cost per month</h2>
                  <p className="text-xs text-slate-500">
                    Each plan normalised to a month at its own minimum quantity, so a yearly plan
                    and a weekly one are finally comparable
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {plans.length.toLocaleString()} plan{plans.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="mt-3">
                <BarList
                  ariaLabel="Monthly cost by plan"
                  labelWidth="w-[8.5rem]"
                  items={plans
                    .map((plan) => ({
                      key: String(plan.id),
                      label: plan.name,
                      value:
                        (plan.price * INTERVALS_PER_YEAR[plan.billingInterval] * plan.minQuantity) /
                        12,
                      color: INTERVAL_ACCENT[plan.billingInterval],
                    }))
                    // Ranked by the value the bar draws, so the list reads top to bottom.
                    .sort((left, right) => right.value - left.value)
                    .map((item) => ({
                      ...item,
                      display: formatMoney(item.value),
                    }))}
                />
              </div>
            </section>

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
                      <h2
                        className={cx(
                          'text-base font-semibold leading-tight',
                          plan.isActive ? 'text-ink' : 'text-slate-500',
                        )}
                      >
                        {plan.name}
                      </h2>
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

                    <div className="mt-4 rounded-lg bg-slate-50 px-3 py-3">
                      <p className="text-xs font-semibold text-slate-700">What this plan includes</p>
                      <ul className="mt-2 space-y-1.5">
                        {planOffers(plan).map((offer) => (
                          <li
                            key={offer}
                            className="flex gap-2 text-xs leading-snug text-slate-600"
                          >
                            <Check
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600"
                              aria-hidden="true"
                            />
                            <span>{offer}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/*
                      The switch panel is an editing surface, so only admins get it.
                      Everyone else reads the same rules in the plain-language list
                      above, which is why the rows are not repeated as static badges.
                    */}
                    {isAdmin ? (
                      <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                        <p className="pt-3 text-xs font-semibold text-slate-700">Lifecycle rules</p>
                        {PLAN_FLAGS.map((flag) => (
                          <div key={flag.key} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-ink">{flag.label}</p>
                              <p className="text-xs leading-snug text-slate-500">{flag.description}</p>
                            </div>
                            <Switch
                              label={`${flag.label} for ${plan.name}`}
                              checked={plan[flag.key]}
                              isBusy={pendingFlag?.planId === plan.id && pendingFlag.key === flag.key}
                              onChange={(next) => toggleFlag(plan, flag.key, next)}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}

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
          </>
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
