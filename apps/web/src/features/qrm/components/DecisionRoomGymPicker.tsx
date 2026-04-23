/**
 * DecisionRoomGymPicker — list of closed-lost deals in the workspace,
 * each linking to its own Decision Room page so the rep can train
 * against a real historical loss. Paired with the replay banner on the
 * receiving page, this is the minimum Phase 5 — a practice surface
 * that plugs into the existing simulator instead of forking a new
 * route.
 *
 * Pure RLS-scoped reads on crm_deals. Hidden when there are no lost
 * deals in the workspace.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Dumbbell, ExternalLink, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DeckSurface } from "./command-deck";

interface Props {
  currentDealId: string;
}

interface LostDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  loss_reason: string | null;
  competitor: string | null;
  updated_at: string | null;
}

async function fetchRecentLosses(excludeDealId: string): Promise<LostDealRow[]> {
  const { data, error } = await supabase
    .from("crm_deals")
    .select("id, name, amount, loss_reason, competitor, updated_at")
    .neq("id", excludeDealId)
    .not("loss_reason", "is", null)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(6);
  if (error || !data) return [];
  return data as LostDealRow[];
}

function formatAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toFixed(0)}`;
}

export function DecisionRoomGymPicker({ currentDealId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["decision-room", "gym-picker", currentDealId],
    queryFn: () => fetchRecentLosses(currentDealId),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return null;
  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Dumbbell className="h-4 w-4 text-qep-live" aria-hidden />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Training gym — practice against a real loss
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Pick a closed-lost deal, load its decision room in replay mode, and try the move you wish
        you'd made. The simulator reacts the same way — so you learn the shape of moves that
        actually would have changed the outcome.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to={`/qrm/deals/${row.id}/decision-room`}
              className="group flex h-full flex-col gap-2 rounded-xl border border-qep-deck-rule bg-qep-deck-elevated/60 p-4 transition-colors hover:border-amber-400/40 focus-visible:border-amber-400/60 focus-visible:outline-none"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  {row.name ?? "(unnamed deal)"}
                </p>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-amber-200" />
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono">
                  {formatAmount(row.amount)}
                </span>
                {row.loss_reason ? (
                  <span className="rounded-full border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-red-200">
                    Lost to {row.loss_reason}
                  </span>
                ) : null}
                {row.competitor ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-200">
                    <Trophy className="h-3 w-3" aria-hidden />
                    {row.competitor}
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </DeckSurface>
  );
}
