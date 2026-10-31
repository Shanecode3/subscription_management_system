import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface BarSegment {
  key: string;
  label: string;
  value: number;
  /** Tailwind background class. Status colours are reserved for actual status. */
  color: string;
  /** Text shown in the legend and the screen-reader summary. Defaults to the number. */
  display?: string;
}

interface StackedBarProps {
  segments: BarSegment[];
  /** Accessible name for the bar, e.g. "Invoices by status". */
  ariaLabel: string;
  empty?: ReactNode;
  className?: string;
}

/**
 * One proportional bar over a whole. Rounded ends, a 2px gap between fills and
 * a hairlie legend, so identity is read from the label rather than the colour
 * alone. With every value at zero it falls back to its `empty` text.
 */
export function StackedBar({ segments, ariaLabel, empty = null, className }: StackedBarProps) {
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);

  if (total <= 0) return <>{empty}</>;

  return (
    <div
      className={cx('flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100', className)}
      role="img"
      aria-label={`${ariaLabel} — ${visible
        .map((segment) => `${segment.label}: ${segment.display ?? segment.value.toLocaleString()}`)
        .join(', ')}`}
    >
      {visible.map((segment) => (
        <span
          key={segment.key}
          className={cx('h-full first:rounded-l-full last:rounded-r-full', segment.color)}
          style={{ flexGrow: segment.value, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

interface ChartLegendProps {
  segments: BarSegment[];
  className?: string;
}

/** Dot, name, value — the legend every multi-segment bar is read with. */
export function ChartLegend({ segments, className }: ChartLegendProps) {
  return (
    <ul className={cx('flex flex-wrap gap-x-4 gap-y-1.5', className)}>
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className={cx('h-2 w-2 rounded-full', segment.color)} aria-hidden="true" />
            {segment.label}
            <span className="font-semibold tabular-nums text-ink">
              {segment.display ?? segment.value.toLocaleString()}
            </span>
          </li>
        ))}
    </ul>
  );
}
