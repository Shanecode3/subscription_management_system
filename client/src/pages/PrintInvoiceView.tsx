import { ArrowLeft, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDate, formatMoney } from '../lib/format';
import type { Invoice } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

interface TaxGroup {
  key: string;
  name: string;
  rate: number;
  amount: number;
}

/**
 * A standalone document rather than a screen inside the app shell: the print
 * stylesheet hides the toolbar and every piece of chrome, so the browser prints
 * only the sheet. Posting the `print` action first records who printed it.
 */
export function PrintInvoiceView() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const { data, isLoading, error } = useApiResource<Invoice>(`/invoices/${id}`);

  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

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

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintError(null);

    try {
      await apiRequest<Invoice>(`/invoices/${id}/print`, { method: 'POST', body: {}, token });
    } catch (requestError) {
      // The paper copy matters more than the audit row: report the problem and
      // still open the print dialog.
      setPrintError(
        requestError instanceof ApiError
          ? `The print action could not be recorded (${requestError.message}) — printing anyway.`
          : 'The print action could not be recorded — printing anyway.',
      );
    } finally {
      setIsPrinting(false);
      window.print();
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between gap-3 px-4">
        <Link
          to={invoice ? `/invoices/${invoice.id}` : '/invoices'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to invoice
        </Link>
        <button
          type="button"
          className="btn-primary w-auto"
          onClick={handlePrint}
          disabled={isLoading || isPrinting || !invoice}
          aria-busy={isPrinting}
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print invoice
        </button>
      </div>

      {printError ? (
        <div className="no-print mx-auto mb-4 max-w-[820px] px-4">
          <Alert tone="warning">{printError}</Alert>
        </div>
      ) : null}

      {isLoading ? (
        <div className="mx-auto h-[720px] max-w-[820px] animate-pulse rounded bg-white print:hidden" />
      ) : error ? (
        <div className="mx-auto max-w-[820px] px-4 print:hidden">
          <Alert tone="error" title="This invoice could not be loaded">
            {error}
          </Alert>
        </div>
      ) : invoice ? (
        <article className="print-sheet mx-auto max-w-[820px] bg-white px-10 py-12 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-plum-600 pb-6">
            <div>
              <p className="text-xl font-semibold tracking-tight text-plum-700">
                Brightloop Software
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Subscription billing platform
                <br />
                14 Residency Road, Bengaluru 560025, India
                <br />
                billing@brightloop.com
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Invoice
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                {invoice.invoiceNumber}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Issued {formatDate(invoice.issueDate)}
                <br />
                Due {formatDate(invoice.dueDate)} · {invoice.paymentTerms}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-700">{invoice.status}</p>
            </div>
          </header>

          <section className="mt-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Bill to
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{invoice.customerName}</p>
              {invoice.customerCompany ? (
                <p className="text-sm text-slate-700">{invoice.customerCompany}</p>
              ) : null}
              <p className="text-sm text-slate-600">{invoice.customerEmail}</p>
              {invoice.customerAddress ? (
                <p className="text-sm text-slate-600">{invoice.customerAddress}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Contract
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                {invoice.subscriptionNumber}
              </p>
              <p className="text-sm text-slate-600">{invoice.planName}</p>
              <p className="text-sm text-slate-600">
                Billing period {formatDate(invoice.billingCycleDate)}
              </p>
            </div>
          </section>

          <table className="mt-8 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-300 text-left text-xs font-semibold text-slate-600">
                <th scope="col" className="py-2 pr-3">Description</th>
                <th scope="col" className="px-2 py-2 text-right">Qty</th>
                <th scope="col" className="px-2 py-2 text-right">Unit price</th>
                <th scope="col" className="px-2 py-2 text-right">Discount</th>
                <th scope="col" className="px-2 py-2 text-right">Tax</th>
                <th scope="col" className="py-2 pl-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-200 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-ink">{line.productName}</p>
                    <p className="text-xs text-slate-500">
                      {line.variantLabel ? `${line.variantLabel} · ` : ''}
                      {line.description}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                    {line.quantity}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                    {formatMoney(line.unitPrice)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                    {line.discountAmount > 0 ? `−${formatMoney(line.discountAmount)}` : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                    {line.taxAmount > 0 ? (
                      <>
                        {formatMoney(line.taxAmount)}
                        <span className="block text-xs text-slate-500">{line.taxRate}%</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-ink">
                    {formatMoney(line.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="mt-6 flex flex-wrap justify-end gap-8">
            <dl className="min-w-[260px] space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-8">
                <dt className="text-slate-600">Subtotal</dt>
                <dd className="tabular-nums text-ink">{formatMoney(invoice.subtotal)}</dd>
              </div>
              {invoice.discountTotal > 0 ? (
                <div className="flex items-center justify-between gap-8">
                  <dt className="text-slate-600">Discount</dt>
                  <dd className="tabular-nums text-ink">−{formatMoney(invoice.discountTotal)}</dd>
                </div>
              ) : null}
              {taxGroups.map((group) => (
                <div key={group.key} className="flex items-center justify-between gap-8">
                  <dt className="text-slate-600">
                    {group.name} ({group.rate}%)
                  </dt>
                  <dd className="tabular-nums text-ink">{formatMoney(group.amount)}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-8 border-t border-slate-300 pt-2">
                <dt className="text-base font-semibold text-ink">Total</dt>
                <dd className="text-base font-semibold tabular-nums text-ink">
                  {formatMoney(invoice.totalAmount)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-8">
                <dt className="text-slate-600">Paid</dt>
                <dd className="tabular-nums text-slate-700">{formatMoney(invoice.amountPaid)}</dd>
              </div>
              <div className="flex items-center justify-between gap-8 border-t border-slate-200 pt-2">
                <dt className="font-semibold text-ink">Balance due</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {formatMoney(invoice.balanceDue)}
                </dd>
              </div>
            </dl>
          </section>

          {invoice.payments.length > 0 ? (
            <section className="mt-8" aria-label="Payments received">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Payments received
              </p>
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-slate-300 text-left text-xs font-semibold text-slate-600">
                    <th scope="col" className="py-2 pr-3">Payment</th>
                    <th scope="col" className="px-2 py-2">Date</th>
                    <th scope="col" className="px-2 py-2">Method</th>
                    <th scope="col" className="px-2 py-2">Reference</th>
                    <th scope="col" className="py-2 pl-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-slate-200">
                      <td className="py-2 pr-3 tabular-nums text-ink">{payment.paymentNumber}</td>
                      <td className="px-2 py-2 tabular-nums text-slate-700">
                        {formatDate(payment.date)}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{payment.method}</td>
                      <td className="px-2 py-2 text-slate-600">
                        {payment.note ?? '—'}
                      </td>
                      <td className="py-2 pl-3 text-right font-semibold tabular-nums text-ink">
                        {formatMoney(payment.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <footer className="mt-10 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
            <p>
              Payment terms: {invoice.paymentTerms}. Please quote {invoice.invoiceNumber} with your
              transfer.
            </p>
            <p className="mt-1">
              Generated by Brightloop Software on {formatDate(invoice.issueDate)}. Every figure on
              this invoice is read from the billing database — no hand-edited totals.
            </p>
          </footer>
        </article>
      ) : null}
    </div>
  );
}
