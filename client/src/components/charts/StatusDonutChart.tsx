import { cx } from '../../lib/cx';

export interface StatusSlice {
  label: string;
  value: number;
  color: string; // Hex colour for the SVG stroke
  bgClass: string; // Tailwind bg class for the legend dot
}

interface StatusDonutChartProps {
  slices: StatusSlice[];
  totalLabel?: string;
  className?: string;
}

/** Surface gap between neighbouring arcs, in user units. */
const ARC_GAP = 2;

/**
 * Status mix as a ring. Every slice is drawn straight from a count the server
 * aggregated, and each arc keeps a small gap from the next so two adjacent
 * states never read as one. The legend is always shown, so a state is never
 * identified by colour alone.
 */
export function StatusDonutChart({
  slices,
  totalLabel = 'contracts',
  className,
}: StatusDonutChartProps) {
  const validSlices = slices.filter((slice) => slice.value > 0);
  const total = validSlices.reduce((sum, slice) => sum + slice.value, 0);

  const size = 160;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const activeSlice = validSlices.find((slice) => slice.label === 'Active');
  const activePercent = total > 0 && activeSlice ? Math.round((activeSlice.value / total) * 100) : 0;

  let offset = 0;

  return (
    <div className={cx('flex flex-col items-center gap-5 sm:flex-row', className)}>
      <div className="relative flex shrink-0 items-center justify-center">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`Contracts by status: ${validSlices
            .map((slice) => `${slice.label} ${slice.value}`)
            .join(', ')}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#F1F5F9"
            strokeWidth={strokeWidth}
          />

          {validSlices.map((slice) => {
            const arc = (slice.value / total) * circumference;
            // Keep the gap, but never let a tiny slice vanish entirely.
            const drawn = Math.max(arc - ARC_GAP, Math.min(arc, 1.5));
            const dashOffset = -offset;
            offset += arc;

            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${drawn} ${circumference - drawn}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            );
          })}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular-nums tracking-tight text-ink">
            {total === 0 ? '—' : `${activePercent}%`}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {total === 0 ? 'No contracts' : 'Active'}
          </span>
        </div>
      </div>

      <div className="w-full space-y-1.5">
        <div className="flex items-baseline justify-between border-b border-slate-100 pb-1.5 text-xs text-slate-500">
          <span>Lifecycle state</span>
          <span className="font-semibold tabular-nums text-slate-700">
            {total} {totalLabel}
          </span>
        </div>

        {total === 0 ? (
          <p className="pt-1 text-xs text-slate-500">No contracts on file yet.</p>
        ) : (
          slices.map((slice) => {
            const share = Math.round((slice.value / total) * 100);
            return (
              <div key={slice.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cx('h-2 w-2 shrink-0 rounded-full', slice.bgClass)}
                  />
                  <span className="truncate text-slate-600">{slice.label}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                  {slice.value}
                  <span className="ml-1 font-normal text-slate-500">{share}%</span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
