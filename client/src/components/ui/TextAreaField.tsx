import type { TextareaHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

export function TextAreaField({
  id,
  label,
  error,
  hint,
  className,
  ...textareaProps
}: TextAreaFieldProps) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {textareaProps.required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </label>
      <textarea
        id={id}
        className={cx('field-input min-h-[88px] resize-y', error && 'field-input-invalid', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...textareaProps}
      />
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
