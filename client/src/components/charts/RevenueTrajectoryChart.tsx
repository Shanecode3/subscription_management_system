import { useState } from 'react';
import { formatMoney } from '../../lib/format';
import { cx } from '../../lib/cx';

export interface TrajectoryDataPoint {
  /** 'YYYY-MM', the key the SQL bucket came back under. */
  period: string;
  /** Short month label for the axis, e.g. "May". */
  label: string;
  invoiced: number;
  collected: number;
}

interface RevenueTrajectoryChartProps {
  data: TrajectoryDataPoint[];
  className?: string;
}

/** Rounds a raw maximum up to 1, 2, 2.5 or 5 × 10^n, so axis ticks read cleanly. */
function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / magnitude;
  const snapped = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return snapped * magnitude;
}

/**
 * SVG line-and-area chart for the six monthly buckets the finance endpoint
 * aggregates in PostgreSQL. It plots exactly the rows it is handed — no point
 * on this chart is computed, smoothed or projected in the browser.
 */
export function RevenueTrajectoryChart({ data, className }: RevenueTrajectoryChartProps) {
  const [activePoint, setActivePoint] = useState<TrajectoryDataPoint | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
        No billing history yet.
      </div>
    );
  }

  // ViewBox dimensions
  const width = 640;
  const height = 220;
  const paddingLeft = 65;
  const paddingRight = 25;
  const paddingTop = 25;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Four even bands above the baseline, with round tick values.
  const maxValue = Math.max(...data.map((d) => Math.max(d.invoiced, d.collected)), 0);
  const step = niceStep(maxValue / 4) || 1;
  const yCeil = step * 4;

  const getX = (index: number) => {
    if (data.length <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (data.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / yCeil) * chartHeight;
  };

  // Build SVG path strings
  const invoicedPoints = data.map((d, i) => `${getX(i)},${getY(d.invoiced)}`);
  const collectedPoints = data.map((d, i) => `${getX(i)},${getY(d.collected)}`);

  const invoicedLinePath = `M ${invoicedPoints.join(' L ')}`;
  const collectedLinePath = `M ${collectedPoints.join(' L ')}`;

  const firstX = getX(0);
  const lastX = getX(data.length - 1);
  const baselineY = paddingTop + chartHeight;

  const invoicedAreaPath = `${invoicedLinePath} L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;
  const collectedAreaPath = `${collectedLinePath} L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;

  const gridLines = [0, 1, 2, 3, 4].map((band) => {
    const val = step * band;
    const y = getY(val);
    return { val, y, isBaseline: band === 0 };
  });

  return (
    <div className={cx('relative w-full select-none', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-plum-600" />
            <span className="font-medium text-slate-700">Invoiced</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="font-medium text-slate-700">Collected</span>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Last {data.length} months · invoices by issue date, cash by payment date
        </p>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-b from-slate-50/50 to-white p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label="Invoiced and collected cash, by month"
          onMouseLeave={() => setActivePoint(null)}
        >
          <defs>
            <linearGradient id="invoicedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#714B67" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#714B67" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="collectedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Gridlines & Y-axis labels */}
          {gridLines.map(({ val, y, isBaseline }) => (
            <g key={val}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={paddingLeft + chartWidth}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray={isBaseline ? undefined : '3,3'}
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-medium"
              >
                ${Math.round(val).toLocaleString()}
              </text>
            </g>
          ))}

          {/* Filled Areas */}
          <path d={invoicedAreaPath} fill="url(#invoicedGrad)" />
          <path d={collectedAreaPath} fill="url(#collectedGrad)" />

          {/* Lines */}
          <path
            d={invoicedLinePath}
            fill="none"
            stroke="#714B67"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={collectedLinePath}
            fill="none"
            stroke="#10B981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points & X-axis Labels */}
          {data.map((d, i) => {
            const x = getX(i);
            const yInv = getY(d.invoiced);
            const yCol = getY(d.collected);
            const isHovered = activePoint?.period === d.period;

            return (
              <g key={d.period}>
                {/* Vertical hover guide */}
                {isHovered ? (
                  <line
                    x1={x}
                    y1={paddingTop}
                    x2={x}
                    y2={baselineY}
                    stroke="#CBD5E1"
                    strokeWidth="1.5"
                    strokeDasharray="2,2"
                  />
                ) : null}

                {/* X-axis Month Label */}
                <text
                  x={x}
                  y={baselineY + 18}
                  textAnchor="middle"
                  className={cx(
                    'text-[11px] font-semibold transition-colors',
                    isHovered ? 'fill-plum-700' : 'fill-slate-500',
                  )}
                >
                  {d.label}
                </text>

                {/* Invoiced Circle */}
                <circle
                  cx={x}
                  cy={yInv}
                  r={isHovered ? '5' : '3.5'}
                  className="fill-white stroke-plum-700 transition-all duration-150"
                  strokeWidth="2"
                />

                {/* Collected Circle */}
                <circle
                  cx={x}
                  cy={yCol}
                  r={isHovered ? '5' : '3.5'}
                  className="fill-white stroke-emerald-600 transition-all duration-150"
                  strokeWidth="2"
                />

                {/* Invisible Hover Target */}
                <rect
                  x={x - chartWidth / (data.length * 2)}
                  y={paddingTop}
                  width={chartWidth / data.length}
                  height={chartHeight + 25}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setActivePoint(d)}
                />
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {activePoint ? (
          <div
            className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur"
            style={{
              left: `${Math.min(
                88,
                Math.max(12, (getX(data.indexOf(activePoint)) / width) * 100),
              )}%`,
            }}
          >
            <p className="text-xs font-bold text-slate-800">{activePoint.label}</p>
            <div className="mt-1 space-y-0.5 text-[11px]">
              <div className="flex justify-between gap-3 text-slate-600">
                <span>Invoiced:</span>
                <span className="font-semibold text-plum-700">
                  {formatMoney(activePoint.invoiced)}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-slate-600">
                <span>Collected:</span>
                <span className="font-semibold text-emerald-700">
                  {formatMoney(activePoint.collected)}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
