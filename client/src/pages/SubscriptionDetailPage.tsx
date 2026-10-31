import { ArrowLeft, Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { StatusStepper } from '../components/subscriptions/StatusStepper';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatDate, formatMoney, intervalLabel } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { ApiError, apiRequest } from '../lib/api';
import { STATUS_TONE, transitionLabel } from '../lib/subscription-status';
import type { Subscription, SubscriptionStatus } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

/**
 * One contract in full: its progression, the moves available from its current
 * state, and the lines the customer is actually paying for. The buttons come
 * from the server's `allowedTransitions`, so the plan flags (pause, early
 * close, renew) are respected without the UI re-implementing them.
 */
export function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { data, setData, isLoading, error, reload } = useApiResource<Subscription>(
    `/subscriptions/${id}`,
  );

  const [pendingStatus, setPendingStatus] = useState<SubscriptionStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const move = async (next: SubscriptionStatus) => {
    if (!data) return;
    setActionError(null);
    setNotice(null);
    setPendingStatus(next);

    try {
      const result = await apiRequest<Subscription>(`/subscriptions/${data.id}/status`, {
        method: 'PUT',
        body: { status: next },
        token,
      });
      setData(result.data);
      setNotice(result.message ?? `Subscription is now ${result.data.status}.`);
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'The status could not be changed. Please try again.',
      );
    } finally {
      setPendingStatus(null);
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <div className="h-10 w-48 animate-pulse rounded bg-slate-100" />
          <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Alert tone="error" title="Subscription could not be loaded">
            {error ?? 'That contract does not exist.'}
          </Alert>
          <div className="flex gap-2">
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
            <Link to="/subscriptions">
              <Button variant="secondary" className="w-auto">
                Back to subscriptions
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const subscription = data;
  const canMove = subscription.allowedTransitions;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Link
            to="/subscriptions"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All subscriptions
          </Link>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {subscription.subscriptionNumber}
              </h1>
              <Badge tone={STATUS_TONE[subscription.status]}>{subscription.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {subscription.customerName} · {subscription.customerEmail}
            </p>
          </div>
          <p className="text-right">
            <span className="block text-xs text-slate-500">Contract value</span>
            <span className="text-xl font-semibold tabular-nums text-ink">
              {formatMoney(subscription.total)}
            </span>
            <span className="block text-xs text-slate-500">
              {intervalLabel(subscription.billingInterval)} billing
            </span>
          </p>
        </header>

        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {actionError ? <Alert tone="error">{actionError}</Alert> : null}

        <section className="card px-5 py-4">
          <StatusStepper status={subscription.status} />

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {canMove.length === 0 ? (
              <p className="text-sm text-slate-500">
                No further moves are available from {subscription.status} on this plan.
              </p>
            ) : (
              canMove.map((next, index) => (
                <Button
                  key={next}
                  variant={index === 0 ? 'primary' : 'secondary'}
                  className="w-auto"
                  isLoading={pendingStatus === next}
                  disabled={pendingStatus !== null && pendingStatus !== next}
                  onClick={() => move(next)}
                >
                  {transitionLabel(next, subscription.status)}
                </Button>
              ))
            )}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="card overflow-hidden lg:col-span-2">
            <h2 className="border-b border-slate-200 bg-slate-50/60 px-5 py-3 text-sm font-semibold text-ink">
              Product lines
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                    <th scope="col" className="px-5 py-2">Product</th>
                    <th scope="col" className="px-3 py-2 text-right">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right">Unit price</th>
                    <th scope="col" className="px-5 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subscription.lines.map((line) => {
                    const isStruck = line.isAddon && !line.isAddonActive;
                    return (
                      <tr key={line.id} className={isStruck ? 'bg-slate-50/60' : undefined}>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={
                                isStruck ? 'font-medium text-slate-400 line-through' : 'font-medium text-ink'
                              }
                            >
                              {line.description}
                            </span>
                            {line.isAddon ? (
                              <Badge tone={line.isAddonActive ? 'teal' : 'neutral'}>
                                {line.isAddonActive ? 'Add-on on' : 'Add-on off'}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">{line.productType}</p>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                          {line.quantity}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                          {formatMoney(line.unitPrice)}
                        </td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums text-ink">
                          {formatMoney(line.subtotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-slate-200 text-sm">
                  <tr>
                    <td colSpan={3} className="px-5 py-2 text-right text-slate-500">
                      Subtotal
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">
                      {formatMoney(subscription.subtotal)}
                    </td>
                  </tr>
                  {subscription.addonTotal > 0 ? (
                    <tr>
                      <td colSpan={3} className="px-5 py-2 text-right text-slate-500">
                        Of which add-ons
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-600">
                        {formatMoney(subscription.addonTotal)}
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <td colSpan={3} className="px-5 py-2.5 text-right font-semibold text-ink">
                      Total
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-ink">
                      {formatMoney(subscription.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="space-y-5">
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-ink">Contract</h2>
              <dl className="mt-3 space-y-2.5 text-sm">
                {[
                  { label: 'Plan', value: subscription.planName },
                  { label: 'Started', value: formatDate(subscription.startDate) },
                  { label: 'Expires', value: formatDate(subscription.expiryDate) },
                  { label: 'Next billing', value: formatDate(subscription.nextBillingDate) },
                  { label: 'Payment terms', value: subscription.paymentTerms },
                  {
                    label: 'Source',
                    value: subscription.templateName ?? 'Built by hand',
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-500">{row.label}</dt>
                    <dd className="text-right font-medium text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="card p-5">
              <h2 className="text-sm font-semibold text-ink">Plan rules</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {[
                  { label: 'Auto-close at expiry', enabled: subscription.flags.autoClose },
                  { label: 'Early close allowed', enabled: subscription.flags.allowEarlyClose },
                  { label: 'Pause and resume', enabled: subscription.flags.allowPause },
                  { label: 'Renewal allowed', enabled: subscription.flags.allowRenew },
                ].map((rule) => (
                  <li key={rule.label} className="flex items-center gap-2">
                    {rule.enabled ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    )}
                    <span className={rule.enabled ? 'text-ink' : 'text-slate-500'}>
                      {rule.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {subscription.notes ? (
              <section className="card p-5">
                <h2 className="text-sm font-semibold text-ink">Notes</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{subscription.notes}</p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
