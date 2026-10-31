import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/**
 * Square, icon-only action. `label` is both the accessible name and the hover
 * tooltip, so an icon-only table row never loses its meaning.
 */
export function IconButton({ label, tone = 'default', className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition-colors',
        tone === 'danger'
          ? 'text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
          : 'text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
