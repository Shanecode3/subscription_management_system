import { CalendarCheck2, Play, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDate, formatMoney, intervalLabel } from '../lib/format';
import type { BillingPreview, BillingRunResult } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

/**
 * The one-click billing screen. It reads a preview computed by the same engine
 * that writes the invoices, so the numbers on this page are the numbers the run
 * will produce — there is no second, hand-maintained estimate.
 */
export function BillingDayView() {
  const { token } = useAuth();
  const { data, isLoading, error, reload } = useApiResource<BillingPreview>('/billing/pending');

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<BillingRunResult | null>(null);

  const preview = data;

  const runBillingDay = async () => {
    setIsConfirmOpen(false);
    setIsRunning(true);
    setRunError(null);

    try {
      const response = await apiRequest<BillingRunResult>('/billing/run-billing-day', {
        method: 'POST',
        body: {},
        token,
      });
      setResult(response.data);
      reload();
    } catch (requestError) {
      setRunError(
        requestError instanceof ApiError
          ? requestError.message
          : 'The billing run could not finish. No invoices were lost — run it again.',
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Billing day"
          description="Every active contract whose next billing date has arrived, priced from its own lines with the live tax rate and the best applicable discount."
          action={
            <Button
              className="w-auto"
              variant="teal"
              onClick={() => setIsConfirmOpen(true)}
              disabled={isRunning || (preview?.dueCount ?? 0) === 0}
              isLoading={isRunning}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Run billing day
            </Button>
          }
        />

        {runError ? <Alert tone="error" title="The run stopped">{runError}</Alert> : null}

        {result ? (
          <section className="card overflow-hidden" aria-label="Billing run result">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-emerald-50/60 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-emerald-900">
                  Run finished at{' '}
                  {new Date(result.ranAt).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </h2>
                <p className="text-xs text-emerald-800">
                  {result.totalEvaluated} contract(s) evaluated · {result.generatedCount} invoiced ·{' '}
                  {result.skippedCount} skipped · {result.failedCount} failed ·{' '}
                  {result.closedCount} closed
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-emerald-800 underline hover:text-emerald-900"
                onClick={() => setResult(null)}
              >
                Dismiss
              </button>
            </div>

            {result.invoices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                      <th scope="col" className="px-5 py-2.5">Invoice</th>
                      <th scope="col" className="px-3 py-2.5">Contract</th>
                      <th scope="col" className="px-3 py-2.5">Customer</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Discount</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Tax</th>
                      <th scope="col" className="px-5 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.invoices.map((invoice) => (
                      <tr key={invoice.invoiceId} className="hover:bg-slate-50/70">
                        <td className="px-5 py-2.5">
                          <Link
                            to={`/invoices/${invoice.invoiceId}`}
                            className="font-semibold text-plum-700 hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{invoice.subscriptionNumber}</td>
                        <td className="px-3 py-2.5 text-ink">{invoice.customerName}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {invoice.discountTotal > 0 ? (
                            <>
                              −{formatMoney(invoice.discountTotal)}
                              {invoice.discountCode ? (
                                <span className="ml-1 text-xs text-slate-400">
                                  {invoice.discountCode}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                          {formatMoney(invoice.taxTotal)}
                        </td>
                        <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-ink">
                          {formatMoney(invoice.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {result.skipped.length > 0 || result.failures.length > 0 || result.closed.length > 0 ? (
              <div className="space-y-3 border-t border-slate-200 px-5 py-4 text-sm">
                {result.failures.map((failure) => (
                  <p key={`failed-${failure.subscriptionId}`} className="text-rose-700">
                    <span className="font-semibold">{failure.subscriptionNumber}</span> —{' '}
                    {failure.message}
                  </p>
                ))}
                {result.skipped.map((skip) => (
                  <p key={`skipped-${skip.subscriptionId}`} className="text-slate-600">
                    <span className="font-semibold">{skip.subscriptionNumber}</span> — {skip.reason}
                  </p>
                ))}
                {result.closed.map((closed) => (
                  <p key={`closed-${closed.subscriptionId}`} className="text-amber-800">
                    <span className="font-semibold">{closed.subscriptionNumber}</span> auto-closed
                    at its expiry date ({formatDate(closed.expiryDate)}).
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="The billing queue could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : preview ? (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="card px-4 py-3">
                <dt className="text-xs font-medium text-slate-500">Contracts due</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                  {preview.dueCount}
                </dd>
              </div>
              <div className="card px-4 py-3">
                <dt className="text-xs font-medium text-slate-500">Invoice value if run now</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-plum-700">
                  {formatMoney(preview.dueTotal)}
                </dd>
              </div>
              <div className="card px-4 py-3">
                <dt className="text-xs font-medium text-slate-500">Closing at expiry</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
                  {preview.closingCount}
                </dd>
              </div>
            </dl>

            {preview.closingCount > 0 ? (
              <Alert tone="warning" title="These contracts close before they are billed">
                {preview.closing
                  .map((item) => `${item.subscriptionNumber} (${formatDate(item.expiryDate)})`)
                  .join(', ')}
              </Alert>
            ) : null}

            <section className="card overflow-hidden" aria-label="Contracts due">
              {preview.items.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={CalendarCheck2}
                    title="Nothing is due today"
                    description="Contracts appear here on their next billing date. Every page reads live contract rows, so this list empties as soon as the run bills them."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-semibold text-slate-500">
                        <th scope="col" className="px-5 py-2.5">Contract</th>
                        <th scope="col" className="px-3 py-2.5">Customer</th>
                        <th scope="col" className="px-3 py-2.5">Plan</th>
                        <th scope="col" className="px-3 py-2.5">Billing date</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Subtotal</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Discount</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Tax</th>
                        <th scope="col" className="px-5 py-2.5 text-right">Invoice total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.items.map((item) => (
                        <tr key={item.subscriptionId} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3">
                            <Link
                              to={`/subscriptions/${item.subscriptionId}`}
                              className="font-semibold text-plum-700 hover:underline"
                            >
                              {item.subscriptionNumber}
                            </Link>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {item.lineCount} billable line{item.lineCount === 1 ? '' : 's'}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-ink">{item.customerName}</p>
                            <p className="text-xs text-slate-500">{item.customerEmail}</p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="text-ink">{item.planName}</p>
                            <p className="text-xs text-slate-500">
                              {intervalLabel(item.billingInterval)} · {item.paymentTerms}
                            </p>
                          </td>
                          <td className="px-3 py-3 tabular-nums text-slate-600">
                            {formatDate(item.nextBillingDate)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                            {formatMoney(item.subtotal)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {item.discountAmount > 0 ? (
                              <span className="text-emerald-700">
                                −{formatMoney(item.discountAmount)}
                                {item.discountCode ? (
                                  <span className="ml-1 block text-xs text-slate-400">
                                    {item.discountCode}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                            {item.taxName ? (
                              <>
                                {formatMoney(item.taxAmount)}
                                <span className="ml-1 block text-xs text-slate-400">
                                  {item.taxName} ({item.taxRate}%)
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-400">No tax</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                            {formatMoney(item.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="flex items-center gap-2 text-xs text-slate-500">
              <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
              Preview as of {formatDate(preview.asOf)}. Invoices are created as drafts with a unique
              billing-cycle key, so running the same day twice cannot bill a contract twice.
            </p>
          </>
        ) : null}
      </div>

      <Modal
        open={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title="Run billing day?"
        description="This creates one draft invoice per due contract and moves each contract to its next billing date."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              className="w-auto"
              onClick={() => setIsConfirmOpen(false)}
            >
              Not yet
            </Button>
            <Button type="button" variant="teal" className="w-auto" onClick={runBillingDay}>
              Generate {preview?.dueCount ?? 0} invoice{(preview?.dueCount ?? 0) === 1 ? '' : 's'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-ink">{preview?.dueCount ?? 0}</span> contract(s) are
            due, worth <span className="font-semibold text-ink">{formatMoney(preview?.dueTotal ?? 0)}</span>.
          </p>
          {preview && preview.closingCount > 0 ? (
            <p className="text-amber-800">
              {preview.closingCount} contract(s) have reached their auto-close date and will be
              closed before invoicing.
            </p>
          ) : null}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Badge tone="teal">Idempotent</Badge>{' '}
            <span className="ml-1">
              Each invoice is keyed to its contract and cycle date in the database. A second run
              for the same period skips those contracts instead of billing them again.
            </span>
          </p>
        </div>
      </Modal>
    </AppShell>
  );
}
