import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

type Variant = 'primary' | 'secondary' | 'teal';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  teal: 'btn-teal',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  isLoading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  isLoading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  // Forms want a full-width submit button, but a toolbar or a pair of
  // lifecycle actions wants its natural width. Joining both classes and
  // letting CSS pick the winner is a coin toss, so an explicit `w-…` from the
  // caller wins outright.
  const hasExplicitWidth = className !== undefined && /(^|\s)w-/.test(className);

  return (
    <button
      className={cx(VARIANT_CLASS[variant], hasExplicitWidth ? null : 'w-full', className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      {...props}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
