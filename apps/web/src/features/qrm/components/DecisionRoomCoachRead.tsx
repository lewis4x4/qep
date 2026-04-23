/**
 * DecisionRoomCoachRead — one-paragraph executive read at the top of the
 * page. Fetches from decision-room-coach-read. Cached per (dealId, snapshot
 * hash) in React Query so re-opens don't re-bill the model.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { DeckSurface } from "./command-deck";
import type { DecisionRoomBoard } from "../lib/decision-room-simulator";

interface Props {
  board: DecisionRoomBoard;
}

export interface CoachReadResponse {
  read: string;
  generatedAt: string;
}

/**
 * Stable hash of the board shape that influences the read. Changes only
 * when a seat's status/stance/confidence/power would meaningfully shift
 * the narrative — so reruns are rare even if other seat details update.
 */
export function coachReadSnapshotKey(board: DecisionRoomBoard): string {
  return board.seats
    .map((s) => `${s.id}:${s.status}:${s.stance}:${s.confidence}:${Math.round(s.vetoWeight * 100)}`)
    .join("|");
}

export function coachReadQueryKey(board: DecisionRoomBoard): readonly unknown[] {
  return ["decision-room", "coach-read", board.dealId, coachReadSnapshotKey(board)] as const;
}

export async function fetchCoachRead(board: DecisionRoomBoard): Promise<CoachReadResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decision-room-coach-read`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        dealId: board.dealId,
        dealName: board.dealName,
        companyName: board.companyName,
        seats: board.seats.map((s) => ({
          status: s.status,
          archetype: s.archetype,
          archetypeLabel: s.archetypeLabel,
          name: s.name,
          title: s.title,
          stance: s.stance,
          powerWeight: s.powerWeight,
          vetoWeight: s.vetoWeight,
          evidence: s.evidence.map((e) => e.label),
        })),
        scores: {
          decisionVelocity: {
            days: board.scores.decisionVelocity.days,
            confidence: board.scores.decisionVelocity.confidence,
          },
          coverage: {
            value: board.scores.coverage.value,
            filled: board.scores.coverage.filled,
            expected: board.scores.coverage.expected,
            missingArchetypes: board.scores.coverage.missingArchetypes,
          },
          consensusRisk: { level: board.scores.consensusRisk.level },
          latentVeto: {
            level: board.scores.latentVeto.level,
            topGhostArchetype: board.scores.latentVeto.topGhostArchetype,
          },
        },
      }),
    },
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `coach read returned ${res.status}`);
  if (typeof payload.read !== "string" || payload.read.length === 0) {
    throw new Error("coach returned empty read");
  }
  return { read: payload.read, generatedAt: payload.generatedAt };
}

export function DecisionRoomCoachRead({ board }: Props) {
  const key = useMemo(() => coachReadQueryKey(board), [board]);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => fetchCoachRead(board),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <DeckSurface className="border-qep-orange/30 bg-gradient-to-br from-qep-orange/[0.06] to-qep-orange/[0.02] p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-qep-orange/15">
            <Sparkles className="h-3.5 w-3.5 text-qep-orange" aria-hidden />
          </span>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-orange">
            Coach's read
          </h2>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-qep-orange"
        >
          {isFetching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-3 w-11/12 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-10/12 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-8/12 animate-pulse rounded bg-white/5" />
        </div>
      ) : error ? (
        <p className="text-sm text-muted-foreground">
          Couldn't generate a read for this room right now.{" "}
          <button
            type="button"
            onClick={() => refetch()}
            className="underline hover:text-qep-orange"
          >
            Retry
          </button>
          .
        </p>
      ) : data ? (
        <p className="text-sm leading-relaxed text-foreground/95">{data.read}</p>
      ) : null}
    </DeckSurface>
  );
}
