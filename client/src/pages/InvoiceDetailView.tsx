import { ArrowLeft, Banknote, CheckCircle2, Printer, Send, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PaymentFormModal } from '../components/billing/PaymentFormModal';
import { AppShell } from '../components/layout/AppShell';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { PaymentInstructions } from '../components/ui/PaymentInstructions';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDate, formatMoney } from '../lib/format';
import { INVOICE_ACTION_LABEL, INVOICE_TONE } from '../lib/invoice-status';
import { PAYMENT_METHOD_TONE } from '../lib/payment-method';
import type { Invoice, InvoiceAction, RecordPaymentResult } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

/** One icon per action keeps the toolbar scannable without extra labels. */
const ACTION_ICON = {
  confirm: CheckCircle2,
  send: Send,
  cancel: XCircle,
  print: Printer,
} as const;

interface TaxGroup {
  key: string;
  name: string;
  rate: number;
  amount: number;
}

export function InvoiceDetailView() {
  const { id } = useParams<{ id: string }>();
  const { user, token } = useAuth();
  const isInternal = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const { data, setData, isLoading, error, reload } = useApiResource<Invoice>(`/invoices/${id}`);

  const [busyAction, setBusyAction] = useState<InvoiceAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  const invoice = data;

  const taxGroups = useMemo<TaxGroup[]>(() => {
    if (!invoice) return [];
    const groups = new Map<string, TaxGroup>();
    for (const line of invoice.lines) {
      if (line.taxAmount <= 0 && line.taxRate <= 0) continue;
      const key = `${line.taxName ?? 'Tax'}@${line.taxRate}`;
      const existing = groups.get(key);
      if (existing) existing.amount += line.taxAmount;
      else
        groups.set(key, {
          key,
          name: line.taxName ?? 'Tax',
          rate: line.taxRate,
          amount: line.taxAmount,
        });
    }
    return [...groups.values()];
  }, [invoice]);

  const performAction = async (action: InvoiceAction) => {
    setIsCancelOpen(false);
    setBusyAction(action);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await apiRequest<Invoice>(`/invoices/${id}/${action}`, {
        method: 'POST',
        body: {},
        token,
      });
      setData(response.data);
      setActionMessage(response.message ?? 'Done.');
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'That action could not be completed. Please try again.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * The payment response is a reconciliation summary, not a whole invoice, so
   * the page refetches: that keeps `allowedActions`, the balance and the history
   * in step with the database rather than with a client-side guess.
   */
  const handlePaymentRecorded = (result: RecordPaymentResult, message: string | undefined) => {
    setIsPaymentOpen(false);
    setActionError(null);
    setActionMessage(message ?? `Payment ${result.payment.paymentNumber} recorded.`);
    reload();
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <Link
          to="/invoices"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All invoices
        </Link>

        {isLoading && !invoice ? (
          <div className="space-y-4">
            <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-80 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="This invoice could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : invoice ? (
          <>
            <PageHeader
              title={invoice.invoiceNumber}
              description={`${invoice.customerName} · ${invoice.subscriptionNumber} · ${invoice.planName}`}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {isInternal && invoice.status === 'Confirmed' && invoice.balanceDue > 0 ? (
                    <Button
                      variant="teal"
                      className="w-auto"
                      onClick={() => setIsPaymentOpen(true)}
                    >
                      <Banknote className="h-4 w-4" aria-hidden="true" />
                      Record payment
                    </Button>
                  ) : null}
                  {invoice.allowedActions.map((action) => {
                    if (action !== 'print' && !isInternal) return null;
                    const Icon = ACTION_ICON[action];
                    if (action === 'print') {
                      return (
                        <Link
                          key={action}
                          to={`/invoices/${invoice.id}/print`}
                          className="btn-secondary w-auto"
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          Print
                        </Link>
                      );
                    }
                    return (
                      <Button
                        key={action}
                        variant={action === 'confirm' ? 'primary' : 'secondary'}
                        className={action === 'cancel' ? 'w-auto text-rose-700' : 'w-auto'}
                        onClick={() =>
                          action === 'cancel' ? setIsCancelOpen(true) : performAction(action)
                        }
                        isLoading={busyAction === action}
                        disabled={busyAction !== null}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {INVOICE_ACTION_LABEL[action]}
                      </Button>
                    );
                  })}
                </div>
              }
            />

            {actionError ? <Alert tone="error">{actionError}</Alert> : null}
            {actionMessage ? <Alert tone="success">{actionMessage}</Alert> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={INVOICE_TONE[invoice.status]}>{invoice.status}</Badge>
              {invoice.isOverdue ? (
                <Badge tone="rose">Overdue by {invoice.daysOverdue} day{invoice.daysOverdue === 1 ? '' : 's'}</Badge>
              ) : null}
              {invoice.sentAt ? <Badge tone="teal">Sent {formatDate(invoice.sentAt.slice(0, 10))}</Badge> : null}
              {invoice.cancelledAt ? (
                <Badge tone="neutral">Cancelled {formatDate(invoice.cancelledAt.slice(0, 10))}</Badge>
              ) : null}
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <section className="card p-5 lg:col-span-2" aria-label="Invoice details">
                <h2 className="text-sm font-semibold text-ink">Billing details</h2>
                <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Bill to</dt>
                    <dd className="mt-0.5 text-ink">
                      <p className="font-semibold">{invoice.customerName}</p>
                      {invoice.customerCompany ? <p>{invoice.customerCompany}</p> : null}
                      <p className="text-slate-600">{invoice.customerEmail}</p>
                      {invoice.customerAddress ? (
                        <p className="text-slate-600">{invoice.customerAddress}</p>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Contract</dt>
                    <dd className="mt-0.5 text-ink">
                      <Link
                        to={`/subscriptions/${invoice.subscriptionId}`}
                        className="font-semibold text-plum-700 hover:underline"
                      >
                        {invoice.subscriptionNumber}
                      </Link>
                      <p className="text-slate-600">{invoice.planName}</p>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Issue date</dt>
                    <dd className="mt-0.5 tabular-nums text-ink">{formatDate(invoice.issueDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Due date</dt>
                    <dd className="mt-0.5 tabular-nums text-ink">
                      {formatDate(invoice.dueDate)}
                      <span className="ml-1 text-xs text-slate-500">({invoice.paymentTerms})</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Billing period</dt>
                    <dd className="mt-0.5 tabular-nums text-ink">{formatDate(invoice.billingCycleDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Cycle key</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-slate-600">
                      {invoice.billingCycleKey}
                    </dd>
                  </div>
                </dl>
              </section>

              <div className="space-y-6">
                <section className="card p-5" aria-label="Invoice totals">
                  <h2 className="text-sm font-semibold text-ink">Totals</h2>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-600">Subtotal</dt>
                      <dd className="tabular-nums text-ink">{formatMoney(invoice.subtotal)}</dd>
                    </div>
                    {invoice.discountTotal > 0 ? (
                      <div className="flex items-center justify-between">
                        <dt className="text-slate-600">Discount</dt>
                        <dd className="tabular-nums text-emerald-700">
                          −{formatMoney(invoice.discountTotal)}
                        </dd>
                      </div>
                    ) : null}
                    {taxGroups.map((group) => (
                      <div key={group.key} className="flex items-center justify-between">
                        <dt className="text-slate-600">
                          {group.name} ({group.rate}%)
                        </dt>
                        <dd className="tabular-nums text-ink">{formatMoney(group.amount)}</dd>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                      <dt className="font-semibold text-ink">Total</dt>
                      <dd className="text-base font-semibold tabular-nums text-ink">
                        {formatMoney(invoice.totalAmount)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-600">Paid</dt>
                      <dd className="tabular-nums text-emerald-700">{formatMoney(invoice.amountPaid)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="font-medium text-ink">Balance due</dt>
                      <dd className="font-semibold tabular-nums text-amber-700">
                        {formatMoney(invoice.balanceDue)}
                      </dd>
                    </div>
                  </dl>
                </section>

                {invoice.balanceDue > 0 && invoice.status === 'Confirmed' ? (
                  <PaymentInstructions
                    invoiceNumber={invoice.invoiceNumber}
                    amount={invoice.balanceDue}
                    paymentTerms={invoice.paymentTerms}
                    dueDate={invoice.dueDate}
                  />
                ) : null}
              </div>
            </div>

            <section className="card overflow-hidden" aria-label="Invoice lines">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-semibold text-slate-500">
                      <th scope="col" className="px-5 py-2.5">Description</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Qty</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Unit price</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Discount</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Tax</th>
                      <th scope="col" className="px-5 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink">{line.productName}</p>
                          <p className="text-xs text-slate-500">
                            {line.variantLabel ? `${line.variantLabel} · ` : ''}
                            {line.description}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                          {line.quantity}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                          {formatMoney(line.unitPrice)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {line.discountAmount > 0 ? (
                            <span className="text-emerald-700">
                              −{formatMoney(line.discountAmount)}
                              {line.discountCode ? (
                                <span className="ml-1 block text-xs text-slate-400">
                                  {line.discountCode}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {line.taxAmount > 0 ? (
                            <span className="text-slate-600">
                              {formatMoney(line.taxAmount)}
                              <span className="ml-1 block text-xs text-slate-400">{line.taxRate}%</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                          {formatMoney(line.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card overflow-hidden" aria-label="Payment history">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
                <h2 className="text-sm font-semibold text-ink">Payments</h2>
                <p className="text-xs text-slate-500">
                  {invoice.payments.length === 0
                    ? 'Nothing received yet'
                    : `${invoice.payments.length} payment${invoice.payments.length === 1 ? '' : 's'} · ${formatMoney(invoice.amountPaid)} received`}
                </p>
              </div>

              {invoice.payments.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">
                  No payment has been recorded against this invoice.
                  {isInternal && invoice.status === 'Confirmed'
                    ? ' Use Record payment when the money arrives.'
                    : ''}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                        <th scope="col" className="px-5 py-2.5">Payment</th>
                        <th scope="col" className="px-3 py-2.5">Date</th>
                        <th scope="col" className="px-3 py-2.5">Method</th>
                        <th scope="col" className="px-3 py-2.5">Reference</th>
                        <th scope="col" className="px-5 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoice.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="px-5 py-3">
                            <p className="font-semibold text-ink">{payment.paymentNumber}</p>
                            <p className="text-xs text-slate-500">
                              Recorded by {payment.recordedByName}
                            </p>
                          </td>
                          <td className="px-3 py-3 tabular-nums text-slate-600">
                            {formatDate(payment.date)}
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone={PAYMENT_METHOD_TONE[payment.method]}>
                              {payment.method}
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {payment.note ?? <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-emerald-700">
                            {formatMoney(payment.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {invoice.notes ? (
              <section className="card p-5" aria-label="Invoice notes">
                <h2 className="text-sm font-semibold text-ink">Notes</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                  {invoice.notes}
                </p>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      <Modal
        open={isCancelOpen}
        onClose={() => setIsCancelOpen(false)}
        title={`Cancel ${invoice?.invoiceNumber ?? 'this invoice'}?`}
        description="A cancelled invoice stays in the ledger for audit, but it can no longer be confirmed or paid."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              className="w-auto"
              onClick={() => setIsCancelOpen(false)}
            >
              Keep invoice
            </Button>
            <Button
              type="button"
              className="w-auto bg-rose-600 hover:bg-rose-700"
              onClick={() => performAction('cancel')}
            >
              Cancel invoice
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          The contract itself keeps running — cancelling an invoice does not pause or close the
          subscription.
        </p>
      </Modal>

      {invoice ? (
        <PaymentFormModal
          open={isPaymentOpen}
          invoice={invoice}
          onClose={() => setIsPaymentOpen(false)}
          onRecorded={handlePaymentRecorded}
        />
      ) : null}
    </AppShell>
  );
}
