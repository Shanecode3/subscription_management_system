import {
  AlarmClock,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Hourglass,
  RefreshCw,
  TrendingUp,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { BarList } from '../components/charts/BarList';
import { ChartLegend, StackedBar, type BarSegment } from '../components/charts/StackedBar';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { SelectField } from '../components/ui/SelectField';
import { formatDate, formatDateTime, formatMoney, intervalLabel } from '../lib/format';
import type { FinanceDashboard, FinanceFilterOptions } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

/**
 * The toolbar keeps two copies of the filters: what the inputs show (`draft`)
 * and what the request used (`applied`). They differ only while the date range
 * is invalid, in which case the dashboard keeps showing the last range that
 * worked and the hint below explains why — better than blanking every figure
 * the moment someone clicks the wrong end of a calendar.
 */
interface ToolbarState {
  startDate: string;
  endDate: string;
  planId: string;
  customerId: string;
}

const EMPTY_FILTERS: ToolbarState = {
  startDate: '',
  endDate: '',
  planId: '',
  customerId: '',
};

function dashboardPath(filters: ToolbarState): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.planId) params.set('planId', filters.planId);
  if (filters.customerId) params.set('customerId', filters.customerId);

  const query = params.toString();
  return query ? `/finance/dashboard?${query}` : '/finance/dashboard';
}

export function FinanceDashboardView() {
  const [draft, setDraft] = useState<ToolbarState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ToolbarState>(EMPTY_FILTERS);
  const [rangeHint, setRangeHint] = useState<string | null>(null);

  const { data, isLoading, error, reload } = useApiResource<FinanceDashboard>(
    useMemo(() => dashboardPath(applied), [applied]),
  );
  const { data: optionsData } = useApiResource<FinanceFilterOptions>('/finance/filter-options');

  const options = optionsData ?? { plans: [], customers: [] };
  const hasFilters = Object.values(applied).some((value) => value !== '');

  const apply = (patch: Partial<ToolbarState>) => {
    const next = { ...draft, ...patch };
    setDraft(next);

    if (next.startDate && next.endDate && next.startDate > next.endDate) {
      setRangeHint(
        'The end date must be on or after the start date. The dashboard is still showing the last valid range.',
      );
      return;
    }

    setRangeHint(null);
    setApplied(next);
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setRangeHint(null);
  };

  const dashboard = data;

  // Overdue is a subset of what is owed, so the two segments must not overlap:
  // the amber length is the part that is still inside its payment terms.
  const owedSegments: BarSegment[] = dashboard
    ? [
        {
          key: 'not-due',
          label: 'Not yet due',
          value: Math.max(dashboard.totalOutstandingOwed - dashboard.totalOverdueOwed, 0),
          color: 'bg-amber-400',
          display: formatMoney(Math.max(dashboard.totalOutstandingOwed - dashboard.totalOverdueOwed, 0)),
        },
        {
          key: 'overdue',
          label: 'Already late',
          value: dashboard.totalOverdueOwed,
          color: 'bg-rose-400',
          display: formatMoney(dashboard.totalOverdueOwed),
        },
      ]
    : [];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Finance dashboard"
          description="Recurring revenue, cash collected and what is still owed — every figure aggregated by PostgreSQL, not by the browser."
          action={
            <Link to="/invoices" className="btn-secondary w-auto">
              Open invoice ledger
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        />

        <section className="card px-4 py-4" aria-label="Dashboard filters">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[150px]">
              <label htmlFor="finance-start-date" className="field-label">
                From
              </label>
              <input
                id="finance-start-date"
                type="date"
                className="field-input"
                value={draft.startDate}
                max={draft.endDate || undefined}
                onChange={(event) => apply({ startDate: event.target.value })}
              />
            </div>

            <div className="min-w-[150px]">
              <label htmlFor="finance-end-date" className="field-label">
                To
              </label>
              <input
                id="finance-end-date"
                type="date"
                className="field-input"
                value={draft.endDate}
                min={draft.startDate || undefined}
                onChange={(event) => apply({ endDate: event.target.value })}
              />
            </div>

            <div className="min-w-[200px] flex-1">
              <SelectField
                id="finance-plan"
                label="Plan"
                value={draft.planId}
                onChange={(event) => apply({ planId: event.target.value })}
              >
                <option value="">All plans</option>
                {options.plans.map((plan) => (
                  <option key={plan.id} value={String(plan.id)}>
                    {plan.name} · {intervalLabel(plan.billingInterval)}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="min-w-[220px] flex-[2]">
              <SelectField
                id="finance-customer"
                label="Customer"
                value={draft.customerId}
                onChange={(event) => apply({ customerId: event.target.value })}
              >
                <option value="">All customers</option>
                {options.customers.map((customer) => (
                  <option key={customer.id} value={String(customer.id)}>
                    {customer.company ?? customer.name} — {customer.email}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="flex items-center gap-2 pb-0.5">
              <Button
                variant="secondary"
                className="w-auto"
                onClick={reload}
                isLoading={isLoading && dashboard !== null}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
              {hasFilters ? (
                <Button variant="secondary" className="w-auto" onClick={clearFilters}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          {rangeHint ? <p className="mt-2 text-xs font-medium text-rose-600">{rangeHint}</p> : null}

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            The date range applies to invoices by issue date and to receipts by payment date. Active
            contracts and MRR always describe the contracts in force today, narrowed by plan and
            customer.
          </p>
        </section>

        {isLoading && !dashboard ? (
          <div className="space-y-4">
            <div className="h-44 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="The dashboard could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : dashboard ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3" aria-label="Revenue summary">
              <article className="card flex flex-col justify-between p-5 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                      <TrendingUp className="h-4 w-4 text-plum-600" aria-hidden="true" />
                      Recurring revenue
                    </p>
                    <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight text-ink">
                      {formatMoney(dashboard.mrr)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      MRR · {formatMoney(dashboard.arr)} annualised
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-semibold tabular-nums tracking-tight text-plum-700">
                      {dashboard.activeSubscriptions.toLocaleString()}
                    </p>
                    <p className="text-sm text-slate-500">
                      active contract{dashboard.activeSubscriptions === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                {dashboard.mrrByInterval.length > 0 ? (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <BarList
                      ariaLabel="Recurring revenue by billing interval"
                      labelWidth="w-20"
                      items={dashboard.mrrByInterval.map((slice) => ({
                        key: slice.billingInterval,
                        label: intervalLabel(slice.billingInterval),
                        value: slice.mrr,
                        display: formatMoney(slice.mrr),
                      }))}
                    />
                    <p className="mt-2.5 text-xs text-slate-500">
                      {dashboard.mrrByInterval
                        .map(
                          (slice) =>
                            `${intervalLabel(slice.billingInterval)}: ${slice.subscriptions} contract${
                              slice.subscriptions === 1 ? '' : 's'
                            }`,
                        )
                        .join(' · ')}
                    </p>
                  </div>
                ) : null}
              </article>

              <article className="card p-5">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                  <CircleDollarSign className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Revenue collected
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-emerald-700">
                  {formatMoney(dashboard.totalRevenueCollected)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {dashboard.totalPayments.toLocaleString()} receipt
                  {dashboard.totalPayments === 1 ? '' : 's'} recorded
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Cash actually received, read from the payments ledger over the selected date range.
                </p>
              </article>
            </section>

            <section className="grid gap-4 md:grid-cols-2" aria-label="Outstanding and overdue">
              <article className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                      <Hourglass className="h-4 w-4 text-amber-600" aria-hidden="true" />
                      Still owed
                    </p>
                    <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-amber-700">
                      {formatMoney(dashboard.totalOutstandingOwed)}
                    </p>
                  </div>
                  <Badge tone="neutral">
                    {dashboard.openInvoiceCount.toLocaleString()} open
                  </Badge>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Balance across every confirmed invoice, whether or not it has fallen due yet.
                </p>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <StackedBar
                    ariaLabel="Money owed, split by whether it is late"
                    segments={owedSegments}
                    empty={<p className="text-xs text-slate-500">Nothing is owed right now.</p>}
                  />
                  <ChartLegend segments={owedSegments} className="mt-2.5" />
                </div>
              </article>

              <article className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                      <AlarmClock className="h-4 w-4 text-rose-600" aria-hidden="true" />
                      Overdue
                    </p>
                    <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-rose-700">
                      {formatMoney(dashboard.totalOverdueOwed)}
                    </p>
                  </div>
                  <Badge tone={dashboard.overdueInvoiceCount > 0 ? 'rose' : 'emerald'}>
                    {dashboard.overdueInvoiceCount.toLocaleString()} late
                  </Badge>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  The part of the balance whose due date has already passed.{' '}
                  {dashboard.overdueInvoiceCount > 0 ? (
                    <a href="#overdue-chase" className="font-medium text-plum-700 hover:underline">
                      Jump to the chase list
                    </a>
                  ) : null}
                </p>
              </article>
            </section>

            <section id="overdue-chase" className="card overflow-hidden" aria-label="Overdue invoices">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-ink">Chase list</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Oldest due date first, so the longest-standing debt sits at the top.
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  Aggregated in {dashboard.queryTimeMs} ms · {formatDateTime(dashboard.generatedAt)}
                </p>
              </div>

              {dashboard.overdueInvoices.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={CheckCircle2}
                    title="Nothing overdue"
                    description="Every confirmed invoice is still inside its payment terms. New arrears appear here the morning after a due date passes."
                  />
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                          <th scope="col" className="px-5 py-2.5">Invoice</th>
                          <th scope="col" className="px-3 py-2.5">Customer</th>
                          <th scope="col" className="px-3 py-2.5">Contract</th>
                          <th scope="col" className="px-3 py-2.5">Due</th>
                          <th scope="col" className="px-3 py-2.5">Late</th>
                          <th scope="col" className="px-3 py-2.5 text-right">Balance</th>
                          <th scope="col" className="px-5 py-2.5 text-right">
                            <span className="sr-only">Record payment</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {dashboard.overdueInvoices.map((invoice) => (
                          <tr key={invoice.id} className="hover:bg-slate-50/70">
                            <td className="px-5 py-3">
                              <Link
                                to={`/invoices/${invoice.id}`}
                                className="font-semibold text-plum-700 hover:text-plum-800 hover:underline"
                              >
                                {invoice.invoiceNumber}
                              </Link>
                              <p className="mt-0.5 text-xs text-slate-500">
                                Issued {formatDate(invoice.issueDate)}
                              </p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-medium text-ink">{invoice.customerName}</p>
                              <p className="text-xs text-slate-500">{invoice.customerEmail}</p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="tabular-nums text-slate-700">
                                {invoice.subscriptionNumber}
                              </p>
                              <p className="text-xs text-slate-500">{invoice.planName}</p>
                            </td>
                            <td className="px-3 py-3 tabular-nums text-slate-600">
                              {formatDate(invoice.dueDate)}
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone="rose">
                                {invoice.daysOverdue.toLocaleString()} day
                                {invoice.daysOverdue === 1 ? '' : 's'}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className="font-semibold tabular-nums text-ink">
                                {formatMoney(invoice.balanceDue)}
                              </p>
                              <p className="text-xs text-slate-500">
                                of {formatMoney(invoice.totalAmount)}
                              </p>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <Link
                                to={`/invoices/${invoice.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                              >
                                <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                                Record payment
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {dashboard.overdueInvoiceCount > dashboard.overdueInvoices.length ? (
                    <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
                      Showing the {dashboard.overdueInvoices.length} oldest of{' '}
                      {dashboard.overdueInvoiceCount.toLocaleString()} overdue invoices. The KPI
                      totals above include every one of them.
                    </p>
                  ) : null}
                </>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
