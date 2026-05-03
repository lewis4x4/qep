/**
 * DecisionRoomWinFormula — mirror of Loss Lens for closed-won deals.
 * Pulls the workspace's recent wins at the same company (or similar-
 * sized deals as a fallback) and shows the pattern: how fast they closed,
 * what size they were, who typically signed. Paired with Loss Lens, this
 * gives the rep both sides of the pattern — the shape of winning and the
 * shape of losing at this account.
 *
 * RLS-scoped reads on crm_deals + crm_deal_stages. No edge function.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DeckSurface } from "./command-deck";
import {
  normalizeDecisionRoomStageRows,
  normalizeDecisionRoomWonDealRows,
  type DecisionRoomWonDealRow,
} from "../lib/decision-room-deal-rows";

interface Props {
  dealId: string;
  companyId: string | null;
  companyName: string | null;
  dealAmount: number | null;
}

async function fetchWonDeals(
  companyId: string | null,
  dealAmount: number | null,
  excludeDealId: string,
): Promise<DecisionRoomWonDealRow[]> {
  // Step 1: stages that are won.
  const { data: stages, error: stageErr } = await supabase
    .from("crm_deal_stages")
    .select("id, is_closed_won")
    .eq("is_closed_won", true);
  if (stageErr || !stages) return [];
  const wonStageIds = normalizeDecisionRoomStageRows(stages).map((s) => s.id);
  if (wonStageIds.length === 0) return [];

  // Step 2: deals at those stages, scoped to this company first.
  if (companyId) {
    const { data, error } = await supabase
      .from("crm_deals")
      .select("id, name, amount, company_id, created_at, updated_at, expected_close_on, stage_id")
      .eq("company_id", companyId)
      .neq("id", excludeDealId)
      .in("stage_id", wonStageIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    const rows = normalizeDecisionRoomWonDealRows(data);
    if (!error && rows.length > 0) return rows;
  }

  // Fallback: workspace-wide wins at similar deal size ±40%.
  if (dealAmount != null && dealAmount > 0) {
    const min = dealAmount * 0.6;
    const max = dealAmount * 1.4;
    const { data, error } = await supabase
      .from("crm_deals")
      .select("id, name, amount, company_id, created_at, updated_at, expected_close_on, stage_id")
      .gte("amount", min)
      .lte("amount", max)
      .neq("id", excludeDealId)
      .in("stage_id", wonStageIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (!error) return normalizeDecisionRoomWonDealRows(data);
  }
  return [];
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const diff = (end - start) / (1000 * 60 * 60 * 24);
  return Math.round(diff);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function formatAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toFixed(0)}`;
}

export function DecisionRoomWinFormula({ dealId, companyId, companyName, dealAmount }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["decision-room", "win-formula", dealId, companyId ?? "", dealAmount ?? 0],
    queryFn: () => fetchWonDeals(companyId, dealAmount, dealId),
    staleTime: 5 * 60 * 1000,
  });

  const pattern = useMemo(() => {
    const rows = data ?? [];
    if (rows.length === 0) return null;
    const amounts = rows.map((r) => r.amount).filter((v): v is number => typeof v === "number" && v > 0);
    const cycles = rows
      .map((r) => daysBetween(r.created_at, r.updated_at))
      .filter((v): v is number => typeof v === "number" && v >= 0);
    return {
      rows,
      medianAmount: median(amounts),
      medianCycleDays: median(cycles),
      sameCompany: rows.every((r) => r.company_id === companyId),
    };
  }, [data, companyId]);

  if (isLoading) return null;
  if (!pattern || pattern.rows.length === 0) return null;

  const scope = pattern.sameCompany ? companyName ?? "this company" : "similar-sized deals in the workspace";
  const count = pattern.rows.length;

  return (
    <DeckSurface className="border-emerald-400/30 bg-emerald-400/[0.04] p-5">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-emerald-300" aria-hidden />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
          Winning formula — {count} closed-won deal{count === 1 ? "" : "s"} at {scope}
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-400/20 bg-black/20 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
            Median deal size
          </p>
          <p className="text-lg font-semibold text-foreground">{formatAmount(pattern.medianAmount)}</p>
        </div>
        <div className="rounded-lg border border-emerald-400/20 bg-black/20 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
            Median cycle length
          </p>
          <p className="text-lg font-semibold text-foreground">
            {pattern.medianCycleDays != null ? `${pattern.medianCycleDays}d` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-400/20 bg-black/20 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
            Recent winners
          </p>
          <ul className="space-y-0.5 text-xs text-foreground/90">
            {pattern.rows.slice(0, 3).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{row.name ?? "(unnamed)"}</span>
                <span className="shrink-0 font-mono text-[11px] text-emerald-200">
                  {formatAmount(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[11px] italic text-muted-foreground">
        {pattern.sameCompany
          ? `This account has bought before at roughly ${formatAmount(pattern.medianAmount)} on a ${pattern.medianCycleDays ?? "—"}-day cycle. Match that shape and the room usually closes.`
          : `Workspace-wide wins at similar size close on a ${pattern.medianCycleDays ?? "—"}-day median. Deals that stretch meaningfully past that tend to slip.`}
      </p>
    </DeckSurface>
  );
}
