import { Banknote } from 'lucide-react';
import { formatDate, formatMoney } from '../../lib/format';

interface PaymentInstructionsProps {
  invoiceNumber: string;
  amount: number;
  paymentTerms: string;
  dueDate: string;
  className?: string;
}

/**
 * What a customer needs to settle an invoice, stated plainly: the amount, the
 * reference to quote and the date it is due. It deliberately carries no bank
 * account or payment-code graphic — this build has no payment gateway, and a
 * scan target that leads nowhere would be worse than none at all.
 */
export function PaymentInstructions({
  invoiceNumber,
  amount,
  paymentTerms,
  dueDate,
  className = '',
}: PaymentInstructionsProps) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <Banknote className="h-4 w-4 text-plum-700" aria-hidden="true" />
        How to pay
      </h3>

      <p className="mt-2 text-xl font-semibold tabular-nums text-ink">{formatMoney(amount)}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        Due {formatDate(dueDate)} · {paymentTerms}
      </p>

      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-600">
        Quote <span className="font-semibold text-slate-800">{invoiceNumber}</span> as the payment
        reference so the receipt is matched to this invoice automatically. Your Brightloop account
        manager records the receipt and the balance here clears.
      </p>
    </section>
  );
}
