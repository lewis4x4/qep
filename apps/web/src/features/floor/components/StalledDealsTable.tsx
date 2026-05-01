/**
 * StalledDealsTable — full-width sortable table of stalled team deals
 * for the iron_manager home below-fold.
 *
 * Replaces the rendering of iron.aging-deals-team for manager. Uses
 * the pipelineDeals + dealStages + repProfiles already returned by
 * useIronManagerData. Stalled = last_activity_at older than 5 days.
 *
 * Default sort: idle days desc (stickiest deals first). Header click
 * toggles sort across the four meaningful columns.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Clock, Loader2 } from "lucide-react";
import { useIronManagerData } from "@/features/dashboards/hooks/useDashboardData";
import type {
  DealStageRow,
  PipelineDealRow,
  RepProfileRow,
} from "@/features/dashboards/lib/pipeline-health";

const STALE_DAY_THRESHOLD = 5;

type SortKey = "idle" | "amount" | "rep" | "deal";
type SortDir = "asc" | "desc";

interface StalledRow {
  id: string;
  name: string;
  amount: number;
  stageName: string;
  repName: string;
  daysIdle: number;
  lastActivityAt: string | null;
}

type StalledPipelineDealRow = PipelineDealRow & { name?: string | null };

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

function normalizePipelineDeals(rows: unknown): StalledPipelineDealRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePipelineDeal).filter((row): row is StalledPipelineDealRow => row !== null);
}

function normalizePipelineDeal(value: unknown): StalledPipelineDealRow | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.stage_id !== "string") {
    return null;
  }
  return {
    id: value.id,
    stage_id: value.stage_id,
    amount: numberValue(value.amount),
    assigned_rep_id: nullableString(value.assigned_rep_id),
    last_activity_at: nullableString(value.last_activity_at),
    name: nullableString(value.name),
  };
}

function normalizeDealStages(rows: unknown): DealStageRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeDealStage).filter((row): row is DealStageRow => row !== null);
}

function normalizeDealStage(value: unknown): DealStageRow | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    sort_order: numberValue(value.sort_order) ?? 0,
  };
}

function normalizeRepProfiles(rows: unknown): RepProfileRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeRepProfile).filter((row): row is RepProfileRow => row !== null);
}

function normalizeRepProfile(value: unknown): RepProfileRow | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    full_name: nullableString(value.full_name),
    email: nullableString(value.email),
  };
}

function formatUsd(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function dateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function idleTone(days: number): string {
  if (days >= 14) return "text-rose-300";
  if (days >= 10) return "text-amber-300";
  return "text-slate-300";
}

function HeaderCell({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const Icon = active ? (dir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <th
      className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors ${active ? "text-slate-200" : "text-slate-500 hover:text-slate-300"}`}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </button>
    </th>
  );
}

export function StalledDealsTable() {
  const { data, isLoading, isError } = useIronManagerData();
  const [sortKey, setSortKey] = useState<SortKey>("idle");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo<StalledRow[]>(() => {
    const deals = normalizePipelineDeals(data?.pipelineDeals ?? []);
    const stages = normalizeDealStages(data?.dealStages ?? []);
    const profiles = normalizeRepProfiles(data?.repProfiles ?? []);

    const stageMap = new Map<string, string>();
    for (const s of stages) stageMap.set(s.id, s.name);
    const profileMap = new Map<string, RepProfileRow>();
    for (const p of profiles) profileMap.set(p.id, p);

    const cutoff = Date.now() - STALE_DAY_THRESHOLD * 86_400_000;

    const out: StalledRow[] = [];
    for (const deal of deals) {
      const lastTime = deal.last_activity_at
        ? new Date(deal.last_activity_at).getTime()
        : 0;
      if (!Number.isFinite(lastTime) || lastTime >= cutoff) continue;
      const days = Math.floor((Date.now() - lastTime) / 86_400_000);
      const profile = deal.assigned_rep_id ? profileMap.get(deal.assigned_rep_id) : null;
      out.push({
        id: deal.id,
        name: deal.name ?? "Untitled deal",
        amount: Number(deal.amount ?? 0),
        stageName: stageMap.get(deal.stage_id) ?? "Stage",
        repName: profile?.full_name ?? (deal.assigned_rep_id ? "Rep" : "Unassigned"),
        daysIdle: days,
        lastActivityAt: deal.last_activity_at,
      });
    }
    return out;
  }, [data]);

  const sortedRows = useMemo(() => {
    const direction = sortDir === "desc" ? -1 : 1;
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sortKey) {
        case "idle":
          return direction * (a.daysIdle - b.daysIdle);
        case "amount":
          return direction * (a.amount - b.amount);
        case "rep":
          return direction * a.repName.localeCompare(b.repName);
        case "deal":
        default:
          return direction * a.name.localeCompare(b.name);
      }
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totalAtRisk = useMemo(
    () => rows.reduce((sum, r) => sum + (r.amount > 0 ? r.amount : 0), 0),
    [rows],
  );

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "deal" || key === "rep" ? "asc" : "desc");
    }
  };

  return (
    <div
      role="figure"
      aria-label="Stalled deals"
      className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121927] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Clock className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h3 className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Stalled deals · 5+ days idle
          </h3>
          {rows.length > 0 ? (
            <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-200">
              {rows.length} · {formatUsd(totalAtRisk)} at risk
            </span>
          ) : null}
        </div>
        <Link
          to="/qrm/deals?stalled=true"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-[#f28a07]"
        >
          Open all →
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Loading stalled deals…
        </div>
      ) : isError ? (
        <p className="mt-4 text-xs text-rose-300">Couldn't load stalled deals.</p>
      ) : sortedRows.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200">
            All clear
          </span>
          <p className="text-xs text-slate-400">
            No deals over {STALE_DAY_THRESHOLD} days idle. Pipeline is moving.
          </p>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.14em]">
              <tr className="border-b border-white/10">
                <HeaderCell label="Deal" sortKey="deal" active={sortKey === "deal"} dir={sortDir} onSort={handleSort} />
                <HeaderCell label="Rep" sortKey="rep" active={sortKey === "rep"} dir={sortDir} onSort={handleSort} />
                <th className="px-3 py-2 font-semibold text-slate-500">Stage</th>
                <HeaderCell label="Amount" sortKey="amount" active={sortKey === "amount"} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="Idle d" sortKey="idle" active={sortKey === "idle"} dir={sortDir} onSort={handleSort} align="right" />
                <th className="px-3 py-2 font-semibold text-slate-500">Last activity</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedRows.slice(0, 12).map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-white/[0.03]">
                  <td className="px-3 py-2">
                    <Link
                      to={`/qrm/deals/${row.id}`}
                      className="block max-w-[260px] truncate font-semibold text-foreground hover:text-[#f28a07]"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate text-slate-300">{row.repName}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {row.stageName}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-kpi font-extrabold tabular-nums text-[#f6a53a]">
                    {formatUsd(row.amount)}
                  </td>
                  <td className={`px-3 py-2 text-right font-kpi font-extrabold tabular-nums ${idleTone(row.daysIdle)}`}>
                    {row.daysIdle >= 14 ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        {row.daysIdle}d
                      </span>
                    ) : (
                      `${row.daysIdle}d`
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{dateShort(row.lastActivityAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to={`/qrm/deals/${row.id}`}
                      className="inline-flex items-center rounded-md border border-[#f28a07]/40 px-2 py-1 font-semibold text-[#f6a53a] transition hover:bg-[#f28a07]/10"
                    >
                      Nudge
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedRows.length > 12 ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Showing 12 of {sortedRows.length} stalled deals ·{" "}
              <Link to="/qrm/deals?stalled=true" className="text-[#f28a07] hover:underline">
                View all →
              </Link>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
