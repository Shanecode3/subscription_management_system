import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export type BadgeTone = 'neutral' | 'plum' | 'teal' | 'emerald' | 'amber' | 'rose';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  plum: 'bg-plum-100 text-plum-800 ring-plum-200',
  teal: 'bg-teal-100 text-teal-800 ring-teal-200',
  emerald: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-100 text-amber-900 ring-amber-200',
  rose: 'bg-rose-100 text-rose-800 ring-rose-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
