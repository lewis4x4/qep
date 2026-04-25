/**
 * TeamPipelineTable — dense rep-by-rep pipeline read for iron_manager.
 *
 * Replaces the bar-chart hero (PipelineByRepWidget) with a scannable
 * table sorted by attention (idle deals first, then pipeline value).
 * Composes purely from `pipelineHealthByRep` already returned by
 * useIronManagerData — no new queries.
 *
 * Columns: rep · deals · pipeline $ · stage breakdown spark · avg
 * idle days · action. TOTAL row at the bottom.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, Users } from "lucide-react";
import { useIronManagerData } from "@/features/dashboards/hooks/useDashboardData";
import type { PipelineHealthRow } from "@/features/dashboards/lib/pipeline-health";

function formatUsd(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function StageSparkBar({ row, max }: { row: PipelineHealthRow; max: number }) {
  const total = Math.max(1, row.preSale + row.close + row.postSale);
  const denom = Math.max(max, total);
  const pre = (row.preSale / denom) * 100;
  const close = (row.close / denom) * 100;
  const post = (row.postSale / denom) * 100;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
      {pre > 0 ? (
        <span
          className="h-full bg-sky-500/70"
          style={{ width: `${pre}%` }}
          title={`${row.preSale} pre-sale`}
        />
      ) : null}
      {close > 0 ? (
        <span
          className="h-full bg-amber-400/80"
          style={{ width: `${close}%` }}
          title={`${row.close} closing`}
        />
      ) : null}
      {post > 0 ? (
        <span
          className="h-full bg-emerald-500/80"
          style={{ width: `${post}%` }}
          title={`${row.postSale} post-sale`}
        />
      ) : null}
    </div>
  );
}

function idleTone(days: number | null): string {
  if (days == null) return "text-slate-500";
  if (days >= 14) return "text-rose-300";
  if (days >= 7) return "text-amber-300";
  return "text-slate-300";
}

export function TeamPipelineTable() {
  const { data, isLoading, isError } = useIronManagerData();

  const rows = useMemo<PipelineHealthRow[]>(() => {
    const source = (data?.pipelineHealthByRep ?? []) as PipelineHealthRow[];
    return [...source].sort((a, b) => {
      const aIdle = a.avgDaysIdle ?? -1;
      const bIdle = b.avgDaysIdle ?? -1;
      if (aIdle !== bIdle) return bIdle - aIdle;
      return (b.totalValue ?? 0) - (a.totalValue ?? 0);
    });
  }, [data]);

  const totals = useMemo(() => {
    let deals = 0;
    let value = 0;
    let pre = 0;
    let close = 0;
    let post = 0;
    let weightedIdle = 0;
    let idleSamples = 0;
    for (const r of rows) {
      deals += r.dealCount;
      value += r.totalValue;
      pre += r.preSale;
      close += r.close;
      post += r.postSale;
      if (r.avgDaysIdle != null && r.dealCount > 0) {
        weightedIdle += r.avgDaysIdle * r.dealCount;
        idleSamples += r.dealCount;
      }
    }
    return {
      deals,
      value,
      pre,
      close,
      post,
      avgIdle: idleSamples > 0 ? weightedIdle / idleSamples : null,
    };
  }, [rows]);

  const maxStageTotal = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const t = r.preSale + r.close + r.postSale;
      if (t > m) m = t;
    }
    return m;
  }, [rows]);

  return (
    <div
      role="figure"
      aria-label="Team pipeline by advisor"
      className="relative flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121927] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h3 className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Team pipeline by advisor
          </h3>
        </div>
        <Link
          to="/qrm/deals"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-[#f28a07]"
        >
          Open pipeline →
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Loading team pipeline…
        </div>
      ) : isError ? (
        <p className="mt-4 text-xs text-rose-300">Couldn't load team pipeline.</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          No active pipeline yet — deals assigned to reps will appear here.
        </p>
      ) : (
        <div className="mt-3 max-h-[640px] overflow-y-auto pr-1">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#121927] text-[10px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Advisor</th>
                <th className="py-2 pr-3 text-right font-semibold">Deals</th>
                <th className="py-2 pr-3 text-right font-semibold">Pipeline</th>
                <th className="py-2 pr-3 font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Stage mix
                    <span className="text-[9px] normal-case tracking-normal text-slate-600">
                      pre · close · post
                    </span>
                  </span>
                </th>
                <th className="py-2 pr-3 text-right font-semibold">Idle d</th>
                <th className="py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row) => {
                const isUnassigned = row.repKey === "unassigned";
                const repHref = isUnassigned
                  ? "/qrm/deals?assigned_to=unassigned"
                  : `/qrm/deals?assigned_to=${encodeURIComponent(row.repKey)}`;
                return (
                  <tr key={row.repKey} className="transition-colors hover:bg-white/[0.03]">
                    <td className="py-2 pr-3">
                      <p className="truncate font-semibold text-foreground">
                        {row.displayName || (isUnassigned ? "Unassigned" : "Rep")}
                      </p>
                      <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {row.preSale} pre · {row.close} close · {row.postSale} post
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-right font-kpi font-extrabold tabular-nums text-foreground">
                      {row.dealCount}
                    </td>
                    <td className="py-2 pr-3 text-right font-kpi font-extrabold tabular-nums text-[#f6a53a]">
                      {formatUsd(row.totalValue)}
                    </td>
                    <td className="py-2 pr-3">
                      <StageSparkBar row={row} max={maxStageTotal} />
                    </td>
                    <td className={`py-2 pr-3 text-right font-kpi tabular-nums ${idleTone(row.avgDaysIdle)}`}>
                      {row.avgDaysIdle == null ? "—" : `${Math.round(row.avgDaysIdle)}d`}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        to={repHref}
                        className="inline-flex items-center rounded-md border border-[#f28a07]/40 px-2 py-1 font-semibold text-[#f6a53a] transition hover:bg-[#f28a07]/10"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-white/15 bg-white/[0.02]">
                <td className="py-2 pr-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Total
                </td>
                <td className="py-2 pr-3 text-right font-kpi font-extrabold tabular-nums text-foreground">
                  {totals.deals}
                </td>
                <td className="py-2 pr-3 text-right font-kpi font-extrabold tabular-nums text-[#f6a53a]">
                  {formatUsd(totals.value)}
                </td>
                <td className="py-2 pr-3 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  {totals.pre} · {totals.close} · {totals.post}
                </td>
                <td className={`py-2 pr-3 text-right font-kpi tabular-nums ${idleTone(totals.avgIdle)}`}>
                  {totals.avgIdle == null ? "—" : `${totals.avgIdle.toFixed(1)}d`}
                </td>
                <td className="py-2" />
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-600">
            Sample of the 250 most-recently-active open deals. Larger workspaces should run reports for full counts.
          </p>
        </div>
      )}
    </div>
  );
}
