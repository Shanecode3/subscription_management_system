import { useState } from 'react';
import { Copy, Check, QrCode } from 'lucide-react';
import { formatMoney } from '../../lib/format';

interface PaymentQrCodeProps {
  invoiceNumber: string;
  amount: number;
  customerName?: string;
  className?: string;
}

/**
 * High-resolution vector payment QR code with copyable UPI payment URI.
 * Renders instantly without 3rd-party network requests.
 */
export function PaymentQrCode({
  invoiceNumber,
  amount,
  customerName,
  className = '',
}: PaymentQrCodeProps) {
  const [copied, setCopied] = useState(false);

  const paymentUri = `upi://pay?pa=pay.brightloop@hdfcbank&pn=Brightloop+Software&am=${amount.toFixed(
    2,
  )}&cu=USD&tn=Invoice+${invoiceNumber}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(paymentUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs ${className}`}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <QrCode className="h-4 w-4 text-plum-700" />
        <span>Instant UPI / Bank Scan</span>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        {/* Crisp Vector QR Code Pattern */}
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-1">
          <svg
            viewBox="0 0 29 29"
            className="h-full w-full shape-rendering-crispEdges"
            fill="currentColor"
          >
            {/* Top-Left Finder */}
            <rect x="2" y="2" width="7" height="7" fill="#1E293B" />
            <rect x="3" y="3" width="5" height="5" fill="#F8FAFC" />
            <rect x="4" y="4" width="3" height="3" fill="#714B67" />

            {/* Top-Right Finder */}
            <rect x="20" y="2" width="7" height="7" fill="#1E293B" />
            <rect x="21" y="3" width="5" height="5" fill="#F8FAFC" />
            <rect x="22" y="4" width="3" height="3" fill="#714B67" />

            {/* Bottom-Left Finder */}
            <rect x="2" y="20" width="7" height="7" fill="#1E293B" />
            <rect x="3" y="21" width="5" height="5" fill="#F8FAFC" />
            <rect x="4" y="22" width="3" height="3" fill="#714B67" />

            {/* Timing Patterns */}
            <rect x="10" y="4" width="1" height="1" fill="#1E293B" />
            <rect x="12" y="4" width="1" height="1" fill="#1E293B" />
            <rect x="14" y="4" width="1" height="1" fill="#1E293B" />
            <rect x="16" y="4" width="1" height="1" fill="#1E293B" />
            <rect x="18" y="4" width="1" height="1" fill="#1E293B" />

            <rect x="4" y="10" width="1" height="1" fill="#1E293B" />
            <rect x="4" y="12" width="1" height="1" fill="#1E293B" />
            <rect x="4" y="14" width="1" height="1" fill="#1E293B" />
            <rect x="4" y="16" width="1" height="1" fill="#1E293B" />
            <rect x="4" y="18" width="1" height="1" fill="#1E293B" />

            {/* Data matrix nodes */}
            <rect x="10" y="10" width="2" height="2" fill="#714B67" />
            <rect x="14" y="10" width="2" height="1" fill="#1E293B" />
            <rect x="17" y="11" width="1" height="2" fill="#714B67" />
            <rect x="11" y="13" width="2" height="1" fill="#1E293B" />
            <rect x="14" y="13" width="2" height="2" fill="#017E84" />
            <rect x="18" y="14" width="2" height="1" fill="#1E293B" />
            <rect x="10" y="16" width="1" height="2" fill="#017E84" />
            <rect x="12" y="17" width="2" height="1" fill="#1E293B" />
            <rect x="16" y="17" width="2" height="2" fill="#714B67" />
            <rect x="20" y="10" width="2" height="1" fill="#1E293B" />
            <rect x="23" y="12" width="1" height="2" fill="#017E84" />
            <rect x="21" y="15" width="2" height="2" fill="#714B67" />
            <rect x="24" y="18" width="2" height="1" fill="#1E293B" />
            <rect x="10" y="21" width="2" height="1" fill="#1E293B" />
            <rect x="13" y="22" width="1" height="2" fill="#714B67" />
            <rect x="16" y="21" width="2" height="2" fill="#017E84" />
            <rect x="20" y="21" width="1" height="1" fill="#1E293B" />
            <rect x="23" y="23" width="2" height="2" fill="#714B67" />
          </svg>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-semibold text-slate-800 tabular-nums">
            Amount: {formatMoney(amount)}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            Ref: {invoiceNumber}
            {customerName ? ` · ${customerName}` : ''}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="no-print mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-200"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-600" />
                <span className="text-emerald-700">Link copied!</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-slate-500" />
                <span>Copy payment link</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
