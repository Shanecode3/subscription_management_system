import { useState } from 'react';
import { Sparkles, TrendingUp, RotateCcw } from 'lucide-react';
import { formatMoney } from '../../lib/format';
import { Button } from '../ui/Button';

interface RevenueForecasterProps {
  currentMrr: number;
  currentActiveCount: number;
}

export function RevenueForecaster({ currentMrr, currentActiveCount }: RevenueForecasterProps) {
  const [growthRate, setGrowthRate] = useState<number>(15); // +15% growth
  const [annualShift, setAnnualShift] = useState<number>(20); // 20% conversion to annual
  const [collectionRate, setCollectionRate] = useState<number>(96); // 96% collection

  const reset = () => {
    setGrowthRate(0);
    setAnnualShift(0);
    setCollectionRate(95);
  };

  // Forecast computations
  const baseMrr = currentMrr > 0 ? currentMrr : 10000;
  const projectedMrr = Math.round(baseMrr * (1 + growthRate / 100) * (1 + (annualShift * 0.05) / 100));
  const projectedArr = projectedMrr * 12;
  const mrrDelta = projectedMrr - baseMrr;

  const projectedCashCollectedYear = Math.round(projectedArr * (collectionRate / 100));
  const projectedActiveContracts = Math.round((currentActiveCount || 5) * (1 + growthRate / 100));

  // 6-month projected trajectory bars
  const months = ['Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6'];
  const monthlyProjection = months.map((month, idx) => {
    const compound = Math.pow(1 + growthRate / 100 / 6, idx + 1);
    const value = Math.round(baseMrr * compound);
    return { month, value };
  });

  const maxProjection = Math.max(...monthlyProjection.map((m) => m.value), 1);

  return (
    <div className="card overflow-hidden border-plum-100 bg-gradient-to-br from-white via-plum-50/20 to-teal-50/20 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum-100 text-plum-700">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
              Interactive Revenue Forecaster & What-If Simulator
              <span className="rounded-full bg-plum-100 px-2 py-0.5 text-[10px] font-semibold text-plum-800">
                Live Model
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Simulate contract growth, billing interval conversions, and projected cash flow in real-time.
            </p>
          </div>
        </div>

        <Button variant="secondary" className="w-auto text-xs py-1.5 px-3" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Reset Baseline
        </Button>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-12">
        {/* Sliders Control Panel */}
        <div className="space-y-4 lg:col-span-5 border-r-0 lg:border-r border-slate-100 lg:pr-6">
          <div>
            <div className="flex justify-between text-xs font-semibold">
              <label htmlFor="growth-slider" className="text-slate-700">
                Subscriber Growth Rate
              </label>
              <span className="text-plum-700 font-bold">+{growthRate}%</span>
            </div>
            <input
              id="growth-slider"
              type="range"
              min="0"
              max="60"
              step="5"
              value={growthRate}
              onChange={(e) => setGrowthRate(Number(e.target.value))}
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-plum-700"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>0% (Steady)</span>
              <span>+30% (Moderate)</span>
              <span>+60% (Aggressive)</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold">
              <label htmlFor="annual-slider" className="text-slate-700">
                Annual Plan Upsell Shift
              </label>
              <span className="text-teal-700 font-bold">{annualShift}% of base</span>
            </div>
            <input
              id="annual-slider"
              type="range"
              min="0"
              max="50"
              step="5"
              value={annualShift}
              onChange={(e) => setAnnualShift(Number(e.target.value))}
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-teal-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>0% (Monthly-only)</span>
              <span>25%</span>
              <span>50% (High Retention)</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold">
              <label htmlFor="collection-slider" className="text-slate-700">
                Payment Collection Rate
              </label>
              <span className="text-emerald-700 font-bold">{collectionRate}%</span>
            </div>
            <input
              id="collection-slider"
              type="range"
              min="80"
              max="100"
              step="1"
              value={collectionRate}
              onChange={(e) => setCollectionRate(Number(e.target.value))}
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-emerald-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
              <span>80%</span>
              <span>90%</span>
              <span>100% (Instant UPI/Auto-debit)</span>
            </div>
          </div>
        </div>

        {/* Projected Metrics & Visual Trajectory */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
              <p className="text-[11px] font-medium text-slate-500">Projected MRR</p>
              <p className="mt-1 text-lg font-bold text-ink tabular-nums">
                {formatMoney(projectedMrr)}
              </p>
              <p className="text-[10px] font-semibold text-emerald-600">
                +{formatMoney(mrrDelta)} /mo
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
              <p className="text-[11px] font-medium text-slate-500">Projected ARR</p>
              <p className="mt-1 text-lg font-bold text-plum-700 tabular-nums">
                {formatMoney(projectedArr)}
              </p>
              <p className="text-[10px] text-slate-400">Annual Run-rate</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-xs col-span-2 sm:col-span-1">
              <p className="text-[11px] font-medium text-slate-500">Projected Cash/Yr</p>
              <p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
                {formatMoney(projectedCashCollectedYear)}
              </p>
              <p className="text-[10px] text-slate-400">{collectionRate}% collection</p>
            </div>
          </div>

          {/* Mini Projected Growth Bars */}
          <div className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-plum-600" />
                6-Month Projected MRR Ramp
              </span>
              <span className="text-[11px] text-slate-400">
                End state: ~{projectedActiveContracts} contracts
              </span>
            </div>

            <div className="grid grid-cols-6 gap-2 items-end h-20 pt-2">
              {monthlyProjection.map((m, i) => {
                const heightPct = Math.max(15, Math.round((m.value / (maxProjection * 1.1)) * 100));
                return (
                  <div key={m.month} className="flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[9px] font-semibold text-slate-700 tabular-nums">
                      ${Math.round(m.value / 1000)}k
                    </span>
                    <div className="w-full rounded-t-md bg-slate-100 overflow-hidden h-full flex items-end">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-plum-600 to-plum-400 transition-all duration-300"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-slate-400 font-medium">M{i + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
