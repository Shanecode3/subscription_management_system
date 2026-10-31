import { cx } from '../../lib/cx';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  isBusy?: boolean;
}

/** Accessible on/off control (role="switch"), used for plan lifecycle flags. */
export function Switch({ checked, onChange, label, disabled = false, isBusy = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled || isBusy}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-teal-600' : 'bg-slate-300',
        (disabled || isBusy) && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cx(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[1.1rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
