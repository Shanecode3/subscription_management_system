import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Tone = 'error' | 'success' | 'info' | 'warning';

const TONE_STYLES: Record<Tone, { wrapper: string; icon: string }> = {
  error: { wrapper: 'border-rose-200 bg-rose-50 text-rose-800', icon: 'text-rose-500' },
  success: { wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: 'text-emerald-600' },
  info: { wrapper: 'border-teal-200 bg-teal-50 text-teal-900', icon: 'text-teal-700' },
  warning: { wrapper: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-600' },
};

const TONE_ICON: Record<Tone, typeof Info> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}

export function Alert({ tone = 'error', title, children }: AlertProps) {
  const Icon = TONE_ICON[tone];
  const styles = TONE_STYLES[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-lg border px-4 py-3 text-sm', styles.wrapper)}
    >
      <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', styles.icon)} aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
