/**
 * DecisionRoomLossLens — pattern-mine historical closed-lost deals at the
 * same company (and, failing that, at similar deal size) and surface the
 * top loss reasons + competitors so the rep doesn't walk into a pattern
 * that's already killed deals here before.
 *
 * Runs entirely from workspace-scoped RLS reads on crm_deals — no edge
 * function needed. Empty state is quiet: if there's no loss history, the
 * panel hides itself.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DeckSurface } from "./command-deck";
import { cn } from "@/lib/utils";
import { DecisionRoomCompetitorCounter } from "./DecisionRoomCompetitorCounter";

interface Props {
  dealId: string;
  companyId: string | null;
  companyName: string | null;
  dealAmount: number | null;
}

interface LostDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  loss_reason: string | null;
  competitor: string | null;
  company_id: string | null;
  expected_close_on: string | null;
  updated_at: string | null;
}

async function fetchLostDeals(
  companyId: string | null,
  dealAmount: number | null,
  excludeDealId: string,
): Promise<LostDealRow[]> {
  // Prefer losses at the same company. Fall back to recent losses at
  // similar deal size (± 40%) if the company has no history.
  if (companyId) {
    const { data, error } = await supabase
      .from("crm_deals")
      .select("id, name, amount, loss_reason, competitor, company_id, expected_close_on, updated_at")
      .eq("company_id", companyId)
      .neq("id", excludeDealId)
      .not("loss_reason", "is", null)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (!error && data && data.length > 0) {
      return data as LostDealRow[];
    }
  }

  if (dealAmount != null && dealAmount > 0) {
    const min = dealAmount * 0.6;
    const max = dealAmount * 1.4;
    const { data, error } = await supabase
      .from("crm_deals")
      .select("id, name, amount, loss_reason, competitor, company_id, expected_close_on, updated_at")
      .gte("amount", min)
      .lte("amount", max)
      .neq("id", excludeDealId)
      .not("loss_reason", "is", null)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (!error && data) {
      return data as LostDealRow[];
    }
  }

  return [];
}

interface Bucket {
  key: string;
  count: number;
}

function topBuckets(values: (string | null)[], limit: number): Bucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    const key = value.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function pluralDeals(n: number): string {
  return n === 1 ? "1 lost deal" : `${n} lost deals`;
}

export function DecisionRoomLossLens({ dealId, companyId, companyName, dealAmount }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["decision-room", "loss-lens", dealId, companyId ?? "", dealAmount ?? 0],
    queryFn: () => fetchLostDeals(companyId, dealAmount, dealId),
    staleTime: 5 * 60 * 1000,
  });

  const patterns = useMemo(() => {
    const rows = data ?? [];
    if (rows.length === 0) return null;
    const reasons = topBuckets(rows.map((d) => d.loss_reason), 3);
    const competitors = topBuckets(rows.map((d) => d.competitor), 3);
    return { rows, reasons, competitors };
  }, [data]);

  if (isLoading) return null;
  if (!patterns || patterns.rows.length === 0) return null;

  const scope = companyId ? companyName ?? "this company" : "similar-sized deals";
  const totalCount = patterns.rows.length;

  return (
    <DeckSurface className="border-amber-400/30 bg-amber-400/[0.04] p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
          Patterns from {pluralDeals(totalCount)} at {scope}
        </h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {patterns.reasons.length > 0 ? (
          <div className="rounded-lg border border-amber-400/20 bg-black/20 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
              <TrendingDown className="h-3 w-3" />
              Top loss reasons
            </p>
            <ul className="space-y-1">
              {patterns.reasons.map((bucket) => {
                const pct = Math.round((bucket.count / totalCount) * 100);
                return (
                  <li
                    key={bucket.key}
                    className="flex items-center justify-between gap-2 text-xs text-foreground/90"
                  >
                    <span className="truncate">{bucket.key}</span>
                    <span className="shrink-0 font-mono text-[11px] text-amber-200">
                      {bucket.count} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {patterns.competitors.length > 0 ? (
          <div className="rounded-lg border border-amber-400/20 bg-black/20 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
              Competitors that won
            </p>
            <ul className="space-y-2">
              {patterns.competitors.map((bucket) => {
                const dominantLossReason = patterns.reasons[0]?.key ?? null;
                return (
                  <li key={bucket.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-foreground/90">
                      <span className="truncate">{bucket.key}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          className={cn(
                            "rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200",
                          )}
                        >
                          ×{bucket.count}
                        </span>
                        <DecisionRoomCompetitorCounter
                          dealId={dealId}
                          competitor={bucket.key}
                          companyName={companyName}
                          lossReasonHint={dominantLossReason}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] italic text-muted-foreground">
        {companyId && totalCount > 0
          ? `This room has already lost ${pluralDeals(totalCount)} at this company. The pattern above is the most likely way it happens again.`
          : `No loss history at this company; the pattern above is drawn from recent losses at similar deal size across the workspace.`}
      </p>
    </DeckSurface>
  );
}
