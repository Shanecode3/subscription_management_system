import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Right-aligned value text. Defaults to the plain number. */
  display?: string;
  /** Tailwind background class for the fill. Defaults to the plum ramp. */
  color?: string;
}

interface BarListProps {
  items: BarItem[];
  /** Scale ceiling. Defaults to the largest value in the list. */
  max?: number;
  /** Accessible name for the group, e.g. "Recurring revenue by interval". */
  ariaLabel: string;
  /** Width class for the label column, so several lists can line up. */
  labelWidth?: string;
  /**
   * Width class for the value column. It is fixed rather than content-sized so
   * every row's track is the same length — otherwise two rows with equal values
   * would draw different bars.
   */
  valueWidth?: string;
  empty?: ReactNode;
}

/**
 * A labelled magnitude list: the label names the row, the length ranks it, the
 * number states it. One hue per list unless a caller passes its own colour, so
 * the bars compare like with like instead of turning into a rainbow.
 */
export function BarList({
  items,
  max,
  ariaLabel,
  labelWidth = 'w-[5.5rem]',
  valueWidth = 'w-[5.5rem]',
  empty = null,
}: BarListProps) {
  if (items.length === 0) return <>{empty}</>;

  const ceiling = max ?? Math.max(...items.map((item) => item.value));

  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {items.map((item) => {
        const share = ceiling > 0 ? (item.value / ceiling) * 100 : 0;
        // A non-zero value always keeps a sliver so the row never reads as zero.
        const width = item.value > 0 ? Math.max(3, Math.min(100, share)) : 0;

        return (
          <li key={item.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <span className={cx('truncate text-xs text-slate-600', labelWidth)} title={item.label}>
              {item.label}
            </span>
            <span className="h-1.5 rounded-full bg-slate-100">
              <span
                className={cx(
                  'block h-1.5 rounded-full transition-[width] duration-300',
                  item.color ?? 'bg-plum-500',
                )}
                style={{ width: `${width}%` }}
              />
            </span>
            <span
              className={cx(
                'truncate text-right text-xs font-semibold tabular-nums text-ink',
                valueWidth,
              )}
            >
              {item.display ?? item.value.toLocaleString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
