/**
 * ManagerForecastCard — weighted-pipeline forecast for the iron_manager
 * rail. Surfaces `forecastDeals` data already fetched by
 * useIronManagerData but currently unrendered on the manager home.
 *
 * No fabricated quota target (no quota table exists yet — Surprise S4
 * applies). Just honest weighted $: this month + total open + the
 * three biggest deals expected to close this month.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, TrendingUp } from "lucide-react";
import { useIronManagerData } from "@/features/dashboards/hooks/useDashboardData";

interface ForecastDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  weighted_amount: number | null;
  expected_close_on: string | null;
  stage_name: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeForecastDeals(rows: unknown): ForecastDealRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeForecastDeal).filter((row): row is ForecastDealRow => row !== null);
}

function normalizeForecastDeal(value: unknown): ForecastDealRow | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: nullableString(value.name),
    amount: numberValue(value.amount),
    weighted_amount: numberValue(value.weighted_amount),
    expected_close_on: nullableString(value.expected_close_on),
    stage_name: nullableString(value.stage_name),
  };
}

function formatUsd(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString([], { month: "long" });
}

export function ManagerForecastCard() {
  const { data, isLoading, isError } = useIronManagerData();

  const stats = useMemo(() => {
    const deals = normalizeForecastDeals(data?.forecastDeals ?? []);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

    let monthWeighted = 0;
    let monthDealCount = 0;
    let totalWeighted = 0;
    let totalDealCount = 0;
    const closingThisMonth: ForecastDealRow[] = [];

    for (const deal of deals) {
      const weighted = Number(deal.weighted_amount ?? 0);
      if (Number.isFinite(weighted) && weighted > 0) {
        totalWeighted += weighted;
        totalDealCount += 1;
      }
      if (!deal.expected_close_on) continue;
      const t = new Date(deal.expected_close_on).getTime();
      if (!Number.isFinite(t)) continue;
      if (t >= monthStart && t < monthEnd) {
        monthWeighted += weighted;
        monthDealCount += 1;
        closingThisMonth.push(deal);
      }
    }

    closingThisMonth.sort(
      (a, b) => Number(b.weighted_amount ?? 0) - Number(a.weighted_amount ?? 0),
    );

    return {
      monthWeighted,
      monthDealCount,
      totalWeighted,
      totalDealCount,
      topClosing: closingThisMonth.slice(0, 3),
      monthLabel: monthLabel(now),
    };
  }, [data]);

  return (
    <div
      role="figure"
      aria-label="Manager forecast"
      className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121927] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h3 className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Forecast
          </h3>
        </div>
        <Link
          to="/qrm/deals"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-[#f28a07]"
        >
          Deals →
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Loading forecast…
        </div>
      ) : isError ? (
        <p className="mt-3 text-xs text-rose-300">Couldn't load forecast.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                {stats.monthLabel} weighted
              </p>
              <p className="mt-1 font-kpi text-2xl font-extrabold leading-none tabular-nums text-white">
                {formatUsd(stats.monthWeighted)}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {stats.monthDealCount} deal{stats.monthDealCount === 1 ? "" : "s"} expected
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Total open weighted
              </p>
              <p className="mt-1 font-kpi text-2xl font-extrabold leading-none tabular-nums text-[#f6a53a]">
                {formatUsd(stats.totalWeighted)}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {stats.totalDealCount} deal{stats.totalDealCount === 1 ? "" : "s"} across all months
              </p>
            </div>
          </div>

          {stats.topClosing.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Top {stats.monthLabel} commits
              </p>
              <ul className="space-y-1">
                {stats.topClosing.map((deal) => (
                  <li key={deal.id}>
                    <Link
                      to={`/qrm/deals/${deal.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 transition-colors hover:border-white/10 hover:bg-white/[0.03]"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                        {deal.name ?? "Deal"}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {deal.stage_name ?? ""}
                      </span>
                      <span className="shrink-0 font-kpi text-xs font-extrabold tabular-nums text-[#f6a53a]">
                        {formatUsd(deal.weighted_amount)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              No deals in {stats.monthLabel} forecast — pipeline gap to address.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
