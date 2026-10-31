import { cx } from '../../lib/cx';

export interface StatusSlice {
  label: string;
  value: number;
  color: string; // Hex color for SVG stroke
  bgClass: string; // Tailwind bg class for legend dot
}

interface StatusDonutChartProps {
  slices: StatusSlice[];
  totalLabel?: string;
  className?: string;
}

/**
 * Ultra lightweight SVG Donut Chart.
 * 0ms latency, pure declarative SVG circle math.
 */
export function StatusDonutChart({
  slices,
  totalLabel = 'Total Contracts',
  className,
}: StatusDonutChartProps) {
  const validSlices = slices.filter((s) => s.value > 0);
  const total = validSlices.reduce((sum, s) => sum + s.value, 0);

  // SVG parameters
  const size = 160;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Active slice for center stat
  const activeSlice = slices.find((s) => s.label.toLowerCase() === 'active');
  const activePercent = total > 0 && activeSlice ? Math.round((activeSlice.value / total) * 100) : 0;

  let currentOffset = 0;

  return (
    <div className={cx('flex flex-col sm:flex-row items-center gap-6', className)}>
      <div className="relative flex shrink-0 items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#F1F5F9"
            strokeWidth={strokeWidth}
          />

          {/* Slices */}
          {validSlices.map((slice) => {
            const fraction = total > 0 ? slice.value / total : 0;
            const strokeDasharray = `${fraction * circumference} ${circumference}`;
            const strokeDashoffset = -currentOffset;
            currentOffset += fraction * circumference;

            return (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-300 hover:opacity-80"
              />
            );
          })}
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tracking-tight text-ink">
            {activePercent}%
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Active
          </span>
        </div>
      </div>

      {/* Legend list */}
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 text-xs text-slate-500">
          <span>Lifecycle State</span>
          <span className="font-semibold text-slate-700">{total} {totalLabel}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {slices.map((slice) => {
            const share = total > 0 ? Math.round((slice.value / total) * 100) : 0;
            return (
              <div key={slice.label} className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 truncate">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', slice.bgClass)} />
                  <span className="truncate text-slate-600">{slice.label}</span>
                </div>
                <span className="font-semibold tabular-nums text-slate-800">
                  {slice.value} <span className="text-[10px] font-normal text-slate-400">({share}%)</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
