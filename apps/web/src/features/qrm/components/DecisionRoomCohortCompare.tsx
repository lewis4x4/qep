/**
 * DecisionRoomCohortCompare — side-by-side comparison of two cohort
 * filters against the same rolling window. Each pane shows its
 * cohort's top moves, mood distribution, and win/loss move counts.
 * Manager use case: "do our new reps try what our veterans try?",
 * or "is our compact track loader pattern different from backhoes?".
 */
import { useMemo, useState } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "./command-deck";
import {
  DEAL_SIZE_COHORTS,
  EQUIPMENT_COHORTS,
  REP_TENURE_COHORTS,
  type CohortFilter,
  type DealSizeCohort,
  type EquipmentCohort,
  type RepTenureCohort,
  EMPTY_COHORT_FILTER,
  filterMatches,
} from "../lib/decision-room-cohorts";
import {
  aggregateMoves,
  type MoveRow,
  type MoodDistribution,
} from "../lib/decision-room-analytics";

interface Props {
  rows: MoveRow[];
  windowDays: number;
}

function moodPctPositive(dist: MoodDistribution): number {
  if (dist.total === 0) return 0;
  return Math.round((dist.positive / dist.total) * 100);
}

function Pane({
  title,
  filter,
  rows,
  onFilterChange,
  onRemove,
}: {
  title: string;
  filter: CohortFilter;
  rows: MoveRow[];
  onFilterChange: (next: CohortFilter) => void;
  onRemove: (() => void) | null;
}) {
  const filtered = useMemo(() => rows.filter((r) => filterMatches(r.cohort, filter)), [rows, filter]);
  const aggregate = useMemo(() => aggregateMoves(filtered, filtered.length), [filtered]);

  function toggleEquipment(key: EquipmentCohort) {
    onFilterChange({
      ...filter,
      equipment: filter.equipment.includes(key)
        ? filter.equipment.filter((k) => k !== key)
        : [...filter.equipment, key],
    });
  }

  function toggleSize(key: DealSizeCohort) {
    onFilterChange({
      ...filter,
      sizes: filter.sizes.includes(key) ? filter.sizes.filter((k) => k !== key) : [...filter.sizes, key],
    });
  }

  function toggleTenure(key: RepTenureCohort) {
    onFilterChange({
      ...filter,
      tenures: filter.tenures.includes(key)
        ? filter.tenures.filter((k) => k !== key)
        : [...filter.tenures, key],
    });
  }

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h3>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Remove
          </button>
        ) : null}
      </div>

      {/* Inline compact filter */}
      <details className="mb-3 rounded-md border border-qep-deck-rule bg-black/10 p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-foreground/90">
          Cohort filter
        </summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {EQUIPMENT_COHORTS.map((def) => (
              <button
                key={def.key}
                type="button"
                onClick={() => toggleEquipment(def.key)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  filter.equipment.includes(def.key)
                    ? "border-qep-orange/50 bg-qep-orange/15 text-qep-orange"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                )}
              >
                {def.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {DEAL_SIZE_COHORTS.map((def) => (
              <button
                key={def.key}
                type="button"
                onClick={() => toggleSize(def.key)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  filter.sizes.includes(def.key)
                    ? "border-qep-orange/50 bg-qep-orange/15 text-qep-orange"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                )}
              >
                {def.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {REP_TENURE_COHORTS.map((def) => (
              <button
                key={def.key}
                type="button"
                onClick={() => toggleTenure(def.key)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  filter.tenures.includes(def.key)
                    ? "border-qep-orange/50 bg-qep-orange/15 text-qep-orange"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                )}
              >
                {def.label}
              </button>
            ))}
          </div>
        </div>
      </details>

      {aggregate.totalMoves === 0 ? (
        <p className="text-xs italic text-muted-foreground">No moves match this cohort.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-qep-deck-rule bg-qep-deck-elevated/60 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Moves</p>
              <p className="text-lg font-semibold text-foreground">{aggregate.totalMoves}</p>
            </div>
            <div className="rounded-md border border-qep-deck-rule bg-qep-deck-elevated/60 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reps</p>
              <p className="text-lg font-semibold text-foreground">{aggregate.uniqueReps}</p>
            </div>
            <div className="rounded-md border border-qep-deck-rule bg-qep-deck-elevated/60 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Positive</p>
              <p className="text-lg font-semibold text-emerald-300">
                {moodPctPositive(aggregate.overallMood)}%
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Top moves
            </p>
            {aggregate.topMoves.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">—</p>
            ) : (
              <ol className="space-y-1.5">
                {aggregate.topMoves.slice(0, 4).map((cluster, i) => (
                  <li
                    key={cluster.signature}
                    className="rounded-md border border-qep-deck-rule bg-qep-deck-elevated/60 p-2"
                  >
                    <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <span className="font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
                      <span className="truncate">{cluster.exemplar}</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      ×{cluster.count} · {moodPctPositive(cluster.mood)}% positive
                      {cluster.medianVelocityDelta != null
                        ? ` · median ${cluster.medianVelocityDelta > 0 ? "+" : ""}${cluster.medianVelocityDelta}d`
                        : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md border border-emerald-400/30 bg-emerald-400/[0.05] p-2">
              <p className="font-semibold uppercase tracking-wider text-emerald-200">Won</p>
              <p className="text-foreground/90">{aggregate.winningPlaybook.rows.length} moves</p>
            </div>
            <div className="rounded-md border border-red-400/30 bg-red-500/[0.05] p-2">
              <p className="font-semibold uppercase tracking-wider text-red-200">Lost</p>
              <p className="text-foreground/90">{aggregate.losingPatterns.rows.length} moves</p>
            </div>
          </div>
        </div>
      )}
    </DeckSurface>
  );
}

export function DecisionRoomCohortCompare({ rows, windowDays }: Props) {
  const [active, setActive] = useState(false);
  const [paneA, setPaneA] = useState<CohortFilter>(EMPTY_COHORT_FILTER);
  const [paneB, setPaneB] = useState<CohortFilter>(EMPTY_COHORT_FILTER);

  if (!active) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setActive(true)}
          className="gap-1.5"
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          Compare two cohorts
        </Button>
      </div>
    );
  }

  return (
    <DeckSurface className="border-qep-live/30 bg-qep-live/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-qep-live">
          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
          Cohort comparison — last {windowDays} days
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setActive(false)}
          className="h-7 gap-1 text-[10px] uppercase tracking-wider"
        >
          <X className="h-3 w-3" />
          Close
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Pane title="Cohort A" filter={paneA} rows={rows} onFilterChange={setPaneA} onRemove={null} />
        <Pane title="Cohort B" filter={paneB} rows={rows} onFilterChange={setPaneB} onRemove={null} />
      </div>
    </DeckSurface>
  );
}
