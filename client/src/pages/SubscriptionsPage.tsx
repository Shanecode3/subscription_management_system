import { ArrowRight, FileStack, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { NewSubscriptionModal } from '../components/subscriptions/NewSubscriptionModal';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { SelectField } from '../components/ui/SelectField';
import { formatDate, formatMoney, intervalLabel } from '../lib/format';
import { STATUS_TONE } from '../lib/subscription-status';
import type { Subscription, SubscriptionStatus } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

const STATUS_OPTIONS: readonly SubscriptionStatus[] = [
  'Draft',
  'Quotation',
  'Confirmed',
  'Active',
  'Paused',
  'Closed',
];

/**
 * The team's subscription board. Every figure here is derived from the rows the
 * API returned from PostgreSQL, so the counts and the table can never disagree.
 */
export function SubscriptionsPage() {
  const { data, setData, isLoading, error, reload } =
    useApiResource<Subscription[]>('/subscriptions');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');

  const subscriptions = data ?? [];

  const counts = useMemo(() => {
    const tally: Record<SubscriptionStatus, number> = {
      Draft: 0,
      Quotation: 0,
      Confirmed: 0,
      Active: 0,
      Paused: 0,
      Closed: 0,
    };
    for (const subscription of subscriptions) tally[subscription.status] += 1;
    return tally;
  }, [subscriptions]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return subscriptions.filter((subscription) => {
      if (statusFilter !== '' && subscription.status !== statusFilter) return false;
      if (needle === '') return true;
      return (
        subscription.subscriptionNumber.toLowerCase().includes(needle) ||
        subscription.customerName.toLowerCase().includes(needle) ||
        subscription.customerEmail.toLowerCase().includes(needle)
      );
    });
  }, [subscriptions, statusFilter, query]);

  const applyCreated = (created: Subscription) => {
    setData([created, ...subscriptions]);
    setIsFormOpen(false);
    setStatusFilter('');
    setQuery('');
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Subscriptions"
          description="Every contract and where it sits in its lifecycle. Open one to move it forward, pause it or close it."
          action={
            <Button className="w-auto" onClick={() => setIsFormOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New subscription
            </Button>
          }
        />

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Subscriptions could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Active', value: counts.Active, tone: 'text-emerald-700' },
                { label: 'Pipeline', value: counts.Draft + counts.Quotation + counts.Confirmed, tone: 'text-plum-700' },
                { label: 'Paused', value: counts.Paused, tone: 'text-amber-700' },
                { label: 'Closed', value: counts.Closed, tone: 'text-slate-600' },
              ].map((stat) => (
                <div key={stat.label} className="card px-4 py-3">
                  <dt className="text-xs font-medium text-slate-500">{stat.label}</dt>
                  <dd className={`mt-1 text-2xl font-semibold tabular-nums ${stat.tone}`}>
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-4">
                <div className="min-w-[180px] flex-1">
                  <SelectField
                    id="subscription-status-filter"
                    label="Status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </SelectField>
                </div>

                <div className="min-w-[220px] flex-[2]">
                  <label htmlFor="subscription-search" className="field-label">
                    Find a contract
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="subscription-search"
                      className="field-input pl-9"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="SUB-2026-1001, customer name or email"
                    />
                  </div>
                </div>
              </div>

              {subscriptions.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={FileStack}
                    title="No subscriptions yet"
                    description="Start a contract from a quotation template or build one by hand. It appears here as a Draft."
                    action={
                      <Button className="w-auto" onClick={() => setIsFormOpen(true)}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        New subscription
                      </Button>
                    }
                  />
                </div>
              ) : visible.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">
                  No contract matches those filters. Try a different status or search term.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                        <th scope="col" className="px-5 py-2.5">Contract</th>
                        <th scope="col" className="px-3 py-2.5">Customer</th>
                        <th scope="col" className="px-3 py-2.5">Plan</th>
                        <th scope="col" className="px-3 py-2.5">Period</th>
                        <th scope="col" className="px-3 py-2.5">Next billing</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Value</th>
                        <th scope="col" className="px-3 py-2.5">Status</th>
                        <th scope="col" className="px-5 py-2.5">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visible.map((subscription) => (
                        <tr key={subscription.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3">
                            <Link
                              to={`/subscriptions/${subscription.id}`}
                              className="font-semibold text-plum-700 hover:text-plum-800 hover:underline"
                            >
                              {subscription.subscriptionNumber}
                            </Link>
                            {subscription.templateName ? (
                              <p className="mt-0.5 text-xs text-slate-500">
                                {subscription.templateName}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-ink">{subscription.customerName}</p>
                            <p className="text-xs text-slate-500">{subscription.customerEmail}</p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-ink">{subscription.planName}</p>
                            <p className="text-xs text-slate-500">
                              {intervalLabel(subscription.billingInterval)} billing
                            </p>
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {formatDate(subscription.startDate)}
                            <span className="text-slate-400"> → </span>
                            {formatDate(subscription.expiryDate)}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-slate-600">
                            {formatDate(subscription.nextBillingDate)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                            {formatMoney(subscription.total)}
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone={STATUS_TONE[subscription.status]}>
                              {subscription.status}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Link
                              to={`/subscriptions/${subscription.id}`}
                              aria-label={`Open ${subscription.subscriptionNumber}`}
                              className="inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
                            >
                              <ArrowRight className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <NewSubscriptionModal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSaved={applyCreated}
      />
    </AppShell>
  );
}
