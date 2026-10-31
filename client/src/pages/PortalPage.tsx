import { CalendarDays, ReceiptText, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { StatusStepper } from '../components/subscriptions/StatusStepper';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { Switch } from '../components/ui/Switch';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDate, formatMoney, intervalLabel } from '../lib/format';
import {
  portalActionFor,
  portalActionLabel,
  STATUS_TONE,
  type PortalAction,
} from '../lib/subscription-status';
import type { Subscription, SubscriptionStatus } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

/** What each state means to the customer, when there is no button to press. */
const STATUS_EXPLANATION: Record<SubscriptionStatus, string> = {
  Draft:
    'Your account manager is still building this offer. Nothing is due and you have nothing to do until it arrives as a quotation.',
  Quotation:
    'This quotation is waiting on you: accept it to start the contract, or decline it if it is not right.',
  Confirmed:
    'You accepted this quotation. Brightloop activates it on the start date, and it bills from then on.',
  Active: 'This plan cannot be paused, closed early or renewed on its terms.',
  Paused: 'This contract is paused. Resume it whenever you are ready to start billing again.',
  Closed: 'This contract has ended. Renew it to start a new period on the same terms.',
};

/**
 * The customer's own window into Brightloop. The list comes from
 * `/portal/subscriptions`, which is filtered by the signed-in account on the
 * server; the switches and buttons post back to the same tenant-scoped routes.
 */
export function PortalPage() {
  const { token } = useAuth();
  const { data, setData, isLoading, error, reload } =
    useApiResource<Subscription[]>('/portal/subscriptions');

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const subscriptions = data ?? [];

  const replace = (updated: Subscription) => {
    setData(subscriptions.map((item) => (item.id === updated.id ? updated : item)));
  };

  const runAction = async (subscription: Subscription, action: PortalAction) => {
    setNotice(null);
    setActionError(null);
    setBusyAction(`${subscription.id}:${action}`);

    try {
      const result = await apiRequest<Subscription>(
        `/portal/subscriptions/${subscription.id}/${action}`,
        { method: 'POST', token },
      );
      replace(result.data);
      setNotice(result.message ?? `Subscription is now ${result.data.status}.`);
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'That change could not be applied. Please try again.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const toggleAddon = async (subscription: Subscription, lineId: number, isActive: boolean) => {
    setNotice(null);
    setActionError(null);
    setBusyAction(`${subscription.id}:line-${lineId}`);

    try {
      const result = await apiRequest<Subscription>(
        `/portal/subscriptions/${subscription.id}/addons`,
        { method: 'PATCH', body: { lineId, isActive }, token },
      );
      replace(result.data);
      setNotice(result.message ?? 'Your subscription has been updated.');
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'That add-on could not be changed. Please try again.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const activeCount = useMemo(
    () => subscriptions.filter((subscription) => subscription.status === 'Active').length,
    [subscriptions],
  );

  const awaitingDecision = useMemo(
    () => subscriptions.filter((subscription) => subscription.status === 'Quotation').length,
    [subscriptions],
  );

  const stats = useMemo(() => {
    let activeSubs = 0;
    let totalPerPeriod = 0;
    let activeAddons = 0;
    let totalAddonAmount = 0;

    for (const s of subscriptions) {
      if (s.status === 'Active') {
        activeSubs += 1;
        totalPerPeriod += s.total;
        totalAddonAmount += s.addonTotal;
        for (const line of s.lines) {
          if (line.isAddon && line.isAddonActive) {
            activeAddons += 1;
          }
        }
      }
    }

    return { activeSubs, totalPerPeriod, activeAddons, totalAddonAmount };
  }, [subscriptions]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="My subscriptions"
          description={
            awaitingDecision > 0
              ? `${awaitingDecision} quotation${awaitingDecision === 1 ? '' : 's'} ${awaitingDecision === 1 ? 'is' : 'are'} waiting on you. Accept to start the contract, or decline it.`
              : activeCount > 0
                ? `You have ${activeCount} active ${activeCount === 1 ? 'subscription' : 'subscriptions'}. Switch add-ons on or off, or manage the contract where your plan allows it.`
                : 'Your contracts with Brightloop, and what each plan lets you do.'
          }
        />

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        {isLoading ? (
          <div className="space-y-4">
            {[0, 1].map((panel) => (
              <div key={panel} className="h-56 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Your subscriptions could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : subscriptions.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No subscriptions yet"
            description="When your account manager sets one up, it appears here with its billing dates and what you are paying for."
          />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="card px-4 py-3">
                <p className="text-xs font-medium text-slate-500">Active Contracts</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{stats.activeSubs}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {subscriptions.length} total contract{subscriptions.length === 1 ? '' : 's'} on file
                </p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-xs font-medium text-slate-500">Active Period Commitment</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-plum-700">
                  {formatMoney(stats.totalPerPeriod)}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">Total recurring cost across all active plans</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-xs font-medium text-slate-500">Active Add-Ons</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">
                  {stats.activeAddons}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatMoney(stats.totalAddonAmount)}/period in configurable options
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-plum-200 bg-plum-50/60 p-4 text-xs">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 shrink-0 text-plum-700" />
                <p className="text-plum-900">
                  <span className="font-semibold">Looking to lower subscription costs?</span> You can toggle add-ons at any time below, or contact your Brightloop Account Manager to switch to annual billing for extended discount eligibility.
                </p>
              </div>
            </div>

            {subscriptions.map((subscription) => {
              const canToggleAddons = subscription.status === 'Active';
              const lifecycleMoves = subscription.allowedTransitions
                .map((next) => portalActionFor(subscription.status, next))
                .filter((action): action is PortalAction => action !== null);
              // A contract that has never been live has a start date, not a
              // renewal date — labelling a quotation "Renews …" is what made a
              // pending offer look like an existing subscription.
              const isLive = subscription.activatedAt !== null;
              const isQuotation = subscription.status === 'Quotation';

              return (
                <article key={subscription.id} className="card overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/60 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-ink">
                          {subscription.subscriptionNumber}
                        </h2>
                        <Badge tone={STATUS_TONE[subscription.status]}>
                          {subscription.status}
                        </Badge>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                        <span>{subscription.planName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{intervalLabel(subscription.billingInterval)} billing</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          {isLive
                            ? `Next bill ${formatDate(subscription.nextBillingDate)}`
                            : `Starts ${formatDate(subscription.startDate)}`}
                          {subscription.expiryDate
                            ? ` · Ends ${formatDate(subscription.expiryDate)}`
                            : ''}
                        </span>
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-slate-500">
                        {isLive
                          ? 'Billed per period'
                          : isQuotation
                            ? 'Quoted total'
                            : 'Contracted total'}
                      </p>
                      <p className="text-lg font-semibold tabular-nums text-ink">
                        {formatMoney(subscription.total)}
                      </p>
                    </div>
                  </div>

                  <div className="border-b border-slate-100 px-5 py-3">
                    <StatusStepper status={subscription.status} />
                  </div>

                  {isQuotation ? (
                    <div className="border-b border-plum-100 bg-plum-50/70 px-5 py-3">
                      <p className="text-sm text-plum-900">
                        <span className="font-semibold">This is a quotation, not an active contract.</span>{' '}
                        Nothing has been billed. Accept it to confirm the terms, or decline it if
                        it is not right.
                      </p>
                    </div>
                  ) : null}

                  <div className="divide-y divide-slate-100">
                    {subscription.lines.map((line) => {
                      const isOff = line.isAddon && !line.isAddonActive;
                      return (
                        <div
                          key={line.id}
                          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                        >
                          <div className="min-w-0">
                            <p className={isOff ? 'font-medium text-slate-400' : 'font-medium text-ink'}>
                              {line.description}
                            </p>
                            <p className="text-xs text-slate-500">
                              {line.quantity} × {formatMoney(line.unitPrice)}
                              {line.isAddon && !line.isAddonActive ? ' · switched off' : ''}
                            </p>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="tabular-nums text-sm font-medium text-ink">
                              {formatMoney(line.subtotal)}
                            </span>
                            {line.isAddon ? (
                              <Switch
                                checked={line.isAddonActive}
                                onChange={(next) => toggleAddon(subscription, line.id, next)}
                                label={`${line.isAddonActive ? 'Switch off' : 'Switch on'} ${line.description}`}
                                disabled={!canToggleAddons}
                                isBusy={busyAction === `${subscription.id}:line-${line.id}`}
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3.5">
                    <p className="text-sm text-slate-600">
                      Total{' '}
                      <span className="font-semibold tabular-nums text-ink">
                        {formatMoney(subscription.total)}
                      </span>
                      {subscription.addonTotal > 0 ? (
                        <span className="ml-1 text-xs text-slate-500">
                          (incl. {formatMoney(subscription.addonTotal)} add-ons)
                        </span>
                      ) : null}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {lifecycleMoves.length === 0 ? (
                        <p className="max-w-md text-xs leading-relaxed text-slate-500">
                          {subscription.status === 'Closed'
                            ? 'This contract has ended and cannot be renewed on its terms. Contact your account manager to start a new subscription.'
                            : STATUS_EXPLANATION[subscription.status]}
                        </p>
                      ) : (
                        lifecycleMoves.map((action) => (
                          <Button
                            key={action}
                            variant={
                              action === 'decline' || action === 'early-close'
                                ? 'secondary'
                                : 'primary'
                            }
                            className="w-auto"
                            isLoading={busyAction === `${subscription.id}:${action}`}
                            disabled={busyAction !== null && busyAction !== `${subscription.id}:${action}`}
                            onClick={() => runAction(subscription, action)}
                          >
                            {portalActionLabel(action)}
                          </Button>
                        ))
                      )}
                    </div>
                  </div>

                  {!canToggleAddons ? (
                    <p className="border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-xs text-slate-500">
                      Add-ons can be switched while the subscription is active.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
