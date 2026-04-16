/**
 * BranchStackHeatmap — per-branch quartile ranking.
 *
 * Slice B: wired to v_branch_stack_ranking so the panel lights up with real
 * data today. Cell coloring reflects inventory_quartile + dead_parts_quartile.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchBranchStackRanking, type BranchStackRow } from "../lib/owner-api";

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function quartileColor(q: number, invert = false): string {
  const tier = invert ? 5 - q : q;
  switch (tier) {
    case 1:
      return "bg-emerald-500/25 text-emerald-100 ring-emerald-400/30";
    case 2:
      return "bg-emerald-500/10 text-emerald-200 ring-emerald-400/15";
    case 3:
      return "bg-amber-500/10 text-amber-200 ring-amber-400/15";
    case 4:
      return "bg-rose-500/20 text-rose-200 ring-rose-400/25";
    default:
      return "bg-white/5 text-slate-300 ring-white/10";
  }
}

export function BranchStackHeatmap() {
  const q = useQuery<BranchStackRow[]>({
    queryKey: ["owner", "branch-stack"],
    queryFn: fetchBranchStackRanking,
    refetchInterval: 180_000,
  });

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-5">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
          Branch Stack
        </p>
        <h3 className="mt-1 text-lg font-semibold text-white">Branch Ranking</h3>
        <p className="mt-1 text-xs text-slate-400">
          Inventory value, dead parts, and at-reorder count by branch. Quartile coloring.
        </p>
      </div>
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.isError && (
        <p className="text-sm text-rose-300">
          {(q.error as Error).message}
        </p>
      )}
      {q.data && q.data.length === 0 && (
        <p className="text-sm text-slate-400">No multi-branch signal yet.</p>
      )}
      {q.data && q.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-1.5 text-sm">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <th className="px-2 text-left">Branch</th>
                <th className="px-2 text-right">Parts</th>
                <th className="px-2 text-right">Inventory</th>
                <th className="px-2 text-right">Dead</th>
                <th className="px-2 text-right">Reorder</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.branch_code} className="text-slate-200">
                  <td className="px-2 text-left font-medium text-white">{r.branch_code}</td>
                  <td className="px-2 text-right">{r.parts_count.toLocaleString()}</td>
                  <td className={`px-2 text-right tabular-nums ring-1 ring-inset rounded-md ${quartileColor(r.inventory_quartile)}`}>
                    {fmtUsd(r.inventory_value)}
                  </td>
                  <td className={`px-2 text-right tabular-nums ring-1 ring-inset rounded-md ${quartileColor(r.dead_parts_quartile_asc, true)}`}>
                    {r.dead_parts} <span className="text-[10px] text-slate-400">({r.dead_pct}%)</span>
                  </td>
                  <td className={`px-2 text-right tabular-nums ring-1 ring-inset rounded-md ${quartileColor(r.reorder_quartile_asc, true)}`}>
                    {r.at_reorder_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
