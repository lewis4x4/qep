/**
 * Hover/click reveal of a KPI's formal definition: formula, source tables,
 * refresh cadence, last calculated. Spec §16: "every KPI card must expose
 * formula, last refresh time, drill action."
 */
import { useState } from "react";
import { Info } from "lucide-react";
import type { MetricDefinition, KpiSnapshot } from "../lib/types";
import { relativeRefresh } from "../lib/formatters";

interface Props {
  definition: MetricDefinition;
  snapshot: KpiSnapshot | null;
}

export function MetricDefinitionPopover({ definition, snapshot }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-label="Show metric definition"
        onClick={() => setOpen((p) => !p)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-50 w-72 rounded-md border border-border bg-popover p-3 shadow-lg">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Formula</p>
          <p className="mt-1 font-mono text-[11px] text-foreground whitespace-pre-wrap">{definition.formula_text}</p>

          <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Source tables</p>
          <p className="mt-0.5 text-[11px] text-foreground">
            {Array.isArray(definition.source_tables) && definition.source_tables.length > 0
              ? definition.source_tables.join(", ")
              : "—"}
          </p>

          <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Refresh cadence</p>
          <p className="mt-0.5 text-[11px] text-foreground">{definition.refresh_cadence}</p>

          <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Last calculated</p>
          <p className="mt-0.5 text-[11px] text-foreground">
            {snapshot?.calculated_at ? `${relativeRefresh(snapshot.calculated_at)} (${snapshot.refresh_state})` : "no snapshot yet — fallback live query"}
          </p>

          {definition.synthetic_weights && (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Synthetic weights</p>
              <ul className="mt-0.5 space-y-0.5 text-[10px] font-mono text-foreground">
                {Object.entries(definition.synthetic_weights).map(([k, v]) => (
                  <li key={k}>{k}: {v}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
