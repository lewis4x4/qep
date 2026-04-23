/**
 * DecisionRoomCoachRead — one-paragraph executive read at the top of the
 * page. Fetches from decision-room-coach-read. Cached per (dealId, snapshot
 * hash) in React Query so re-opens don't re-bill the model.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DeckSurface } from "./command-deck";
import type { DecisionRoomBoard } from "../lib/decision-room-simulator";
import { coachReadQueryKey, fetchCoachRead } from "../lib/decision-room-coach-read-api";

interface Props {
  board: DecisionRoomBoard;
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
          {/* Background-refetch pill. Appears when the room shape has
              changed (seat flipped, stance moved) and the coach is re-
              reading with the new board. Hidden on initial load because
              the skeleton below already communicates that. */}
          {isFetching && !isLoading ? (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-1 rounded-full border border-qep-orange/30 bg-qep-orange/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-qep-orange"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
              Re-reading
            </span>
          ) : null}
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
        <p
          className={cn(
            "text-sm leading-relaxed text-foreground/95 transition-opacity duration-200",
            // Dim the stale paragraph slightly while the new read loads
            // so the "Re-reading" pill and the content match visually.
            isFetching && "opacity-60",
          )}
        >
          {data.read}
        </p>
      ) : null}
    </DeckSurface>
  );
}
