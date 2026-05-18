import { Calendar, TrendingUp } from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";

interface PipelineForecastStripProps {
  deals: RepPipelineDeal[];
  /** Max stage_sort across the workspace, used to derive stage probability. */
  maxStageSort: number;
}

export function PipelineForecastStrip({
  deals,
  maxStageSort,
}: PipelineForecastStripProps) {
  const forecast = buildForecast(deals, maxStageSort);
  if (!forecast) return null;

  const {
    monthName,
    daysLeft,
    forecastValue,
    committedValue,
    stretchValue,
    coveragePct,
    closingDealCount,
  } = forecast;

  return (
    <div className="px-4 pt-3 pb-1">
      <section
        aria-label={`End of month forecast for ${monthName}: ${formatCurrency(forecastValue)} weighted close, ${daysLeft} days left`}
        className="relative overflow-hidden rounded-2xl border border-qep-orange/25 px-4 py-3"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,119,34,0.06) 0%, rgba(232,119,34,0.02) 50%, rgba(232,119,34,0.08) 100%)",
        }}
      >
        {/* Decorative glow */}
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-qep-orange/10 blur-[28px]"
        />

        {/* Header row */}
        <div className="relative flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-qep-orange" aria-hidden />
            <p className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.12em]">
              EOM Forecast · {monthName}
            </p>
          </div>
          <p className="text-[10px] font-extrabold text-qep-orange uppercase tracking-[0.06em]">
            {daysLeft}d left
          </p>
        </div>

        {/* Big number */}
        <div className="relative flex items-baseline gap-2 mb-2.5">
          <span className="text-[24px] font-black text-foreground tracking-[-0.02em] leading-none">
            {formatCurrency(forecastValue)}
          </span>
          <span className="text-[11px] text-muted-foreground font-medium">
            weighted close
          </span>
          {closingDealCount > 0 && (
            <span className="text-[11px] ml-auto text-muted-foreground/80">
              {closingDealCount} {closingDealCount === 1 ? "deal" : "deals"}
            </span>
          )}
        </div>

        {/* Coverage bar */}
        <div className="relative h-[5px] rounded-full bg-white/[0.05] overflow-hidden mb-2">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(4, coveragePct))}%`,
              background:
                "linear-gradient(90deg, #E87722 0%, #F29556 60%, #FBBF24 100%)",
            }}
          />
        </div>

        {/* Footer split */}
        <div className="relative flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">
            <span className="text-emerald-400 font-bold">
              {formatCurrency(committedValue)}
            </span>{" "}
            committed
          </span>
          <span className="text-muted-foreground flex items-center gap-1">
            Stretch
            <TrendingUp className="w-3 h-3 text-qep-orange" aria-hidden />
            <span className="text-foreground font-bold">
              {formatCurrency(stretchValue)}
            </span>
          </span>
        </div>
      </section>
    </div>
  );
}

interface Forecast {
  monthName: string;
  daysLeft: number;
  forecastValue: number;
  committedValue: number;
  stretchValue: number;
  coveragePct: number;
  closingDealCount: number;
}

function buildForecast(
  deals: RepPipelineDeal[],
  maxStageSort: number,
): Forecast | null {
  if (deals.length === 0) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const monthName = now.toLocaleDateString(undefined, { month: "long" });
  const daysLeft = Math.max(
    0,
    Math.ceil((monthEnd.getTime() - now.getTime()) / 86_400_000),
  );

  const closingThisMonth = deals.filter((d) => {
    if (!d.expected_close_on) return false;
    const close = new Date(d.expected_close_on);
    return close >= monthStart && close <= monthEnd;
  });

  if (closingThisMonth.length === 0) return null;

  const safeMax = Math.max(maxStageSort, 1);

  // Forecast = sum of (amount × stage probability)
  const forecastValue = closingThisMonth.reduce((sum, d) => {
    const prob = Math.min(1, d.stage_sort / safeMax);
    return sum + (d.amount ?? 0) * prob;
  }, 0);

  // Stretch = sum of full amounts for deals closing this month
  const stretchValue = closingThisMonth.reduce(
    (sum, d) => sum + (d.amount ?? 0),
    0,
  );

  // Committed = deals at >=70% stage progression closing this month
  const committedValue = closingThisMonth.reduce((sum, d) => {
    const prob = d.stage_sort / safeMax;
    return prob >= 0.7 ? sum + (d.amount ?? 0) : sum;
  }, 0);

  const coveragePct =
    stretchValue > 0 ? (forecastValue / stretchValue) * 100 : 0;

  return {
    monthName,
    daysLeft,
    forecastValue,
    committedValue,
    stretchValue,
    coveragePct,
    closingDealCount: closingThisMonth.length,
  };
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}
