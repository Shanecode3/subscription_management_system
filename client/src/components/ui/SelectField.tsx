import type { SelectHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function SelectField({
  id,
  label,
  error,
  hint,
  className,
  children,
  ...selectProps
}: SelectFieldProps) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {selectProps.required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </label>
      <select
        id={id}
        className={cx('field-input', error && 'field-input-invalid', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...selectProps}
      >
        {children}
      </select>
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
