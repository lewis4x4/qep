/**
 * DecisionRoomDealLens — "deals like this one" card for the simulator.
 *
 * Classifies the current deal's cohort (equipment × size) and shows
 * what's happened on past deals of the same shape across the whole
 * workspace:
 *   - Number of similar past deals and moves
 *   - How many closed won vs lost
 *   - Top 3 moves from that cohort (clickable → pre-fills Try-a-move)
 *
 * Tenure is deliberately NOT used for the match query. A rep's own
 * tenure affects which moves THEY'd reach for, but the question this
 * card answers is "what's worked on deals shaped like this one" — that
 * lens is about the deal, not about the rep.
 *
 * Shares the React Query cache key with the analytics page, so if the
 * rep has already opened analytics this session the fetch is free.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BarChart3,
  Compass,
  Minus,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DeckSurface } from "./command-deck";
import {
  classifyDealSize,
  classifyEquipment,
  DEAL_SIZE_COHORTS,
  EQUIPMENT_COHORTS,
  type DealSizeCohort,
  type EquipmentCohort,
} from "../lib/decision-room-cohorts";
import { aggregateMoves, type MoveCluster } from "../lib/decision-room-analytics";
import { fetchMoveRows, moveRowsQueryKey } from "../lib/decision-room-moves-fetch";

const DEFAULT_WINDOW_DAYS = 90;
const MIN_SAMPLE = 3;

interface Props {
  dealId: string;
  dealName: string | null;
  dealAmount: number | null;
  machineInterest: string | null;
  onPickMove: (moveText: string) => void;
}

function equipmentLabel(key: EquipmentCohort): string {
  if (key === "unknown") return "Unknown equipment";
  if (key === "other_machine") return "Other machine";
  return EQUIPMENT_COHORTS.find((d) => d.key === key)?.label ?? "Unknown equipment";
}

function sizeLabel(key: DealSizeCohort): string {
  return DEAL_SIZE_COHORTS.find((d) => d.key === key)?.label ?? "—";
}

function winBiasTone(won: number, lost: number): string {
  if (won + lost === 0) return "border-white/15 bg-white/[0.02] text-muted-foreground";
  const pct = won / (won + lost);
  if (pct >= 0.7) return "border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-200";
  if (pct <= 0.3) return "border-red-400/40 bg-red-500/[0.08] text-red-200";
  return "border-amber-400/40 bg-amber-400/[0.05] text-amber-200";
}

function winBiasLabel(won: number, lost: number): string {
  if (won + lost === 0) return "untested outcome";
  if (won > lost) return `${won} of ${won + lost} led to a win`;
  if (lost > won) return `${lost} of ${won + lost} ended in a loss`;
  return `split ${won}-${lost} on outcome`;
}

interface ClusterWithOutcomes extends MoveCluster {
  wonCount: number;
  lostCount: number;
}

function annotateClusterOutcomes(
  clusters: MoveCluster[],
  rows: import("../lib/decision-room-analytics").MoveRow[],
): ClusterWithOutcomes[] {
  // Re-cluster just the won + lost rows so we can project each cluster's
  // outcome bias without re-running aggregateMoves twice.
  return clusters.map((cluster) => {
    const matches = rows.filter((r) => {
      // Re-use the same signature: matching moves that share this cluster's
      // exemplar's cluster signature. Cheap approximation — in practice the
      // exemplar token set is what the cluster is built from.
      const sigA = cluster.signature;
      const sigB = clusterSignatureFallback(r.moveText);
      return sigA === sigB;
    });
    let wonCount = 0;
    let lostCount = 0;
    for (const m of matches) {
      if (m.dealStageIsWon === true) wonCount += 1;
      else if (m.dealStageIsLost === true) lostCount += 1;
    }
    return { ...cluster, wonCount, lostCount };
  });
}

/**
 * Mirrors the signature logic from decision-room-analytics.clusterSignature.
 * Kept local so this file doesn't depend on the exact internal function
 * name if it gets renamed.
 */
function clusterSignatureFallback(moveText: string): string {
  const STOP = new Set([
    "a", "an", "the", "to", "for", "and", "or", "of", "on", "in", "with", "at",
    "by", "this", "that", "these", "those", "my", "our", "your",
  ]);
  const tokens = moveText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
  const ranked = [...tokens].sort((a, b) => (b.length !== a.length ? b.length - a.length : a.localeCompare(b)));
  return ranked.slice(0, 3).sort().join(" ");
}

export function DecisionRoomDealLens({
  dealId,
  dealName,
  dealAmount,
  machineInterest,
  onPickMove,
}: Props) {
  const equipment = useMemo(
    () => classifyEquipment({ machineInterest, dealName }),
    [machineInterest, dealName],
  );
  const size = useMemo(() => classifyDealSize(dealAmount), [dealAmount]);

  const { data: rows, isLoading } = useQuery({
    queryKey: moveRowsQueryKey(DEFAULT_WINDOW_DAYS),
    queryFn: () => fetchMoveRows(DEFAULT_WINDOW_DAYS),
    staleTime: 5 * 60 * 1_000,
  });

  const cohortRows = useMemo(() => {
    if (!rows) return [] as import("../lib/decision-room-analytics").MoveRow[];
    return rows.filter((r) => {
      if (r.dealId === dealId) return false; // exclude this deal's own moves
      if (r.cohort.equipment !== equipment) return false;
      if (r.cohort.size !== size) return false;
      return true;
    });
  }, [rows, equipment, size, dealId]);

  const aggregate = useMemo(
    () => (cohortRows.length > 0 ? aggregateMoves(cohortRows, DEFAULT_WINDOW_DAYS) : null),
    [cohortRows],
  );

  const clustersWithOutcomes = useMemo(
    () => (aggregate ? annotateClusterOutcomes(aggregate.topMoves.slice(0, 3), cohortRows) : []),
    [aggregate, cohortRows],
  );

  const uniqueDeals = aggregate?.uniqueDeals ?? 0;
  const wonMoves = aggregate?.winningPlaybook.rows.length ?? 0;
  const lostMoves = aggregate?.losingPatterns.rows.length ?? 0;

  const isUnknownShape =
    equipment === "unknown" ||
    (equipment === "other_machine" && size === "unsized");

  return (
    <DeckSurface className="border-qep-live/30 bg-qep-live/[0.04] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-qep-live" aria-hidden />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
            Deals like this one
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-foreground/90">
            {equipmentLabel(equipment)}
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-foreground/90">
            {sizeLabel(size)}
          </span>
          <Button asChild size="sm" variant="ghost" className="h-6 gap-1 text-[10px] uppercase tracking-wider">
            <Link to="/qrm/decision-room/analytics">
              <BarChart3 className="h-3 w-3" />
              Analytics
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-3 w-11/12 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-9/12 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-7/12 animate-pulse rounded bg-white/5" />
        </div>
      ) : isUnknownShape ? (
        <p className="text-sm text-muted-foreground">
          This deal doesn't have enough shape signal yet (add equipment + amount to power cohort matching).
        </p>
      ) : aggregate && uniqueDeals >= MIN_SAMPLE && clustersWithOutcomes.length > 0 ? (
        <>
          <p className="text-sm text-foreground/90">
            <span className="font-semibold">{uniqueDeals} past deal{uniqueDeals === 1 ? "" : "s"}</span>{" "}
            in this cohort across the workspace. {wonMoves} move
            {wonMoves === 1 ? "" : "s"} ran against one that later won,{" "}
            {lostMoves} ran against one that later lost. Here's what the
            pattern looked like:
          </p>
          <ol className="mt-3 space-y-2">
            {clustersWithOutcomes.map((cluster, i) => {
              const tone = winBiasTone(cluster.wonCount, cluster.lostCount);
              const bias = winBiasLabel(cluster.wonCount, cluster.lostCount);
              const positivePct =
                cluster.mood.total > 0
                  ? Math.round((cluster.mood.positive / cluster.mood.total) * 100)
                  : 0;
              return (
                <li key={cluster.signature} className={cn("rounded-lg border p-3", tone)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <span className="font-mono text-[11px] text-muted-foreground">{i + 1}.</span>
                        <span className="truncate">{cluster.exemplar}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>×{cluster.count} tried · {positivePct}% positive</span>
                        <span className="text-foreground/90">{bias}</span>
                        {cluster.medianVelocityDelta != null ? (
                          <span>
                            median{" "}
                            <span
                              className={cn(
                                "font-mono",
                                cluster.medianVelocityDelta < 0
                                  ? "text-emerald-300"
                                  : cluster.medianVelocityDelta > 0
                                    ? "text-red-300"
                                    : "text-white/80",
                              )}
                            >
                              {cluster.medianVelocityDelta > 0 ? "+" : ""}
                              {cluster.medianVelocityDelta}d
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {cluster.wonCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                          <ThumbsUp className="h-3 w-3" />
                          {cluster.wonCount}
                        </span>
                      ) : null}
                      {cluster.lostCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-200">
                          <ThumbsDown className="h-3 w-3" />
                          {cluster.lostCount}
                        </span>
                      ) : null}
                      {cluster.wonCount === 0 && cluster.lostCount === 0 ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Minus className="h-3 w-3" />
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onPickMove(cluster.exemplar)}
                      className="h-7 gap-1 text-[11px]"
                    >
                      Try this move here
                      <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not enough past deals in this cohort yet. Try a move against this room — it'll be the first data point
          for the {equipmentLabel(equipment)} × {sizeLabel(size)} bucket.
        </p>
      )}
    </DeckSurface>
  );
}
