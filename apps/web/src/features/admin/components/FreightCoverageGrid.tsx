import { US_STATES, type StateCode } from "../lib/us-states";
import type { FreightCoverage } from "../lib/price-sheets-api";

interface FreightCoverageGridProps {
  coverage: FreightCoverage;
  activeFilter: StateCode | null;
  onFilter: (state: StateCode | null) => void;
}

/**
 * Top-of-drawer visual: 51 state pills colored by coverage status.
 *   green = covered by exactly one zone (clean)
 *   amber = covered by 2+ zones (overlap)
 *   grey  = uncovered
 * Click a state to filter the zones list below; click again to clear.
 */
export function FreightCoverageGrid({
  coverage,
  activeFilter,
  onFilter,
}: FreightCoverageGridProps) {
  const coveredSet = new Set(coverage.covered);
  const overlapSet = new Set(coverage.overlaps.map((o) => o.state_code));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {US_STATES.map((state) => {
          const isCovered = coveredSet.has(state.code);
          const isOverlap = overlapSet.has(state.code);
          const isActive = activeFilter === state.code;

          const colorClass = isOverlap
            ? "bg-warning/20 text-warning-foreground border-warning/60"
            : isCovered
            ? "bg-success/20 text-success-foreground border-success/60"
            : "bg-muted/40 text-muted-foreground border-border";

          return (
            <button
              key={state.code}
              type="button"
              onClick={() => onFilter(isActive ? null : state.code)}
              title={`${state.name}${
                isOverlap ? " · overlap" : isCovered ? " · covered" : " · uncovered"
              }`}
              className={[
                "min-w-[2.25rem] px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border transition-all",
                colorClass,
                isActive ? "ring-2 ring-primary scale-105" : "hover:scale-105",
              ].join(" ")}
            >
              {state.code}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-success/40 border border-success/60 mr-1.5" />
          {coverage.covered.length - coverage.overlaps.length} covered
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-warning/40 border border-warning/60 mr-1.5" />
          {coverage.overlaps.length} overlap
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-muted border border-border mr-1.5" />
          {coverage.uncovered.length} uncovered
        </span>
        {activeFilter && (
          <button
            type="button"
            onClick={() => onFilter(null)}
            className="ml-auto text-primary hover:underline"
          >
            Clear filter
          </button>
        )}
      </div>
    </div>
  );
}
