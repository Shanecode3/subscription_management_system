import { Check, X } from 'lucide-react';
import { cx } from '../../lib/cx';

interface Rule {
  label: string;
  isMet: (password: string) => boolean;
}

/** Mirrors server/src/utils/validators.ts so the user sees the same rules live. */
const RULES: Rule[] = [
  { label: 'At least 9 characters', isMet: (value) => value.length >= 9 },
  { label: 'One uppercase letter', isMet: (value) => /[A-Z]/.test(value) },
  { label: 'One lowercase letter', isMet: (value) => /[a-z]/.test(value) },
  { label: 'One special character', isMet: (value) => /[^a-zA-Z0-9]/.test(value) },
  { label: 'No spaces', isMet: (value) => !/\s/.test(value) },
];

export function PasswordChecklist({ password }: { password: string }) {
  const allMet = RULES.every((rule) => rule.isMet(password));

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Password requirements
      </p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {RULES.map((rule) => {
          const met = rule.isMet(password);
          const Icon = met ? Check : X;

          return (
            <li
              key={rule.label}
              className={cx(
                'flex items-center gap-1.5 text-xs',
                met ? 'text-emerald-700' : 'text-slate-500',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{rule.label}</span>
            </li>
          );
        })}
      </ul>
      {password.length > 0 && allMet ? (
        <p className="mt-2 text-xs font-medium text-emerald-700" role="status">
          This password meets every requirement.
        </p>
      ) : null}
    </div>
  );
}
