/**
 * DecisionRoomPatternBanner — "Rooms like this one" insight.
 *
 * Cross-deal pattern memory MVP. Queries the pattern-lookup edge function
 * with the current dealId; if it finds >=2 closed-lost deals in the
 * workspace with the same equipment class + size band, renders a single-
 * line insight under Coach's Read with the top loss reason.
 *
 * Renders nothing (null) when:
 *   - loading (avoids flash)
 *   - no narrative comes back (not enough signal yet in this workspace)
 *   - the request errors (errors aren't rep-actionable — silent failure)
 *
 * Extension points: the full `topLossReasons` list and `sampleDealNames`
 * are already wired through the response so a future expanded view can
 * show the full cohort without another fetch.
 */
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { fetchPatternLookup, patternLookupQueryKey } from "../lib/decision-room-pattern-api";

interface Props {
  dealId: string;
}

export function DecisionRoomPatternBanner({ dealId }: Props) {
  const { data } = useQuery({
    queryKey: patternLookupQueryKey(dealId),
    queryFn: () => fetchPatternLookup({ dealId }),
    // Stale for 5 minutes — pattern shifts over weeks, not seconds. The
    // board-change refetch chain doesn't need to include this key.
    staleTime: 5 * 60 * 1000,
    // Fail silently: if we can't reach the edge function, don't show a
    // broken banner. The room still works without historical context.
    retry: 1,
  });

  if (!data?.narrative) return null;

  return (
    <section
      aria-label="Cross-deal pattern insight"
      className="flex items-start gap-3 rounded-lg border border-qep-live/25 bg-qep-live/5 p-3"
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-qep-live/40 bg-qep-live/10"
      >
        <History className="h-3.5 w-3.5 text-qep-live" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
          Rooms like this one
        </p>
        <p className="mt-1 text-sm leading-relaxed text-foreground/90">{data.narrative}</p>
        {data.topLossReasons.length > 1 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Other reasons this shape has died:{" "}
            {data.topLossReasons
              .slice(1)
              .map((r) => `${r.reason} (${r.count})`)
              .join(" · ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
