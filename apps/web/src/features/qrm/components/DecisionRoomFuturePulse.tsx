/**
 * DecisionRoomFuturePulse — three horizon cards (7d / 14d / 30d) showing
 * how this room is likely to drift without intervention. Deterministic,
 * no model call. Each card expands to show the trace that produced it.
 */
import { useState } from "react";
import { Clock, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeckSurface } from "./command-deck";
import type { FutureTick } from "../lib/decision-room-future";

interface Props {
  ticks: FutureTick[];
}

function driftTone(drift: number): string {
  if (drift === 0) return "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200";
  if (drift <= 3) return "border-white/15 bg-white/[0.03] text-white/80";
  if (drift <= 8) return "border-amber-400/40 bg-amber-400/10 text-amber-200";
  return "border-red-400/40 bg-red-500/10 text-red-200";
}

function driftLabel(drift: number): string {
  if (drift === 0) return "Steady";
  if (drift > 0) return `+${drift}d slower`;
  return `${Math.abs(drift)}d faster`;
}

export function DecisionRoomFuturePulse({ ticks }: Props) {
  const [openHorizon, setOpenHorizon] = useState<string | null>(null);

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-qep-live" aria-hidden />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Future pulse — without action
          </h2>
        </div>
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          Drift from current velocity
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {ticks.map((tick) => {
          const expanded = openHorizon === tick.horizon;
          return (
            <button
              key={tick.horizon}
              type="button"
              onClick={() => setOpenHorizon(expanded ? null : tick.horizon)}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
                driftTone(tick.velocityDrift),
                "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange/60",
              )}
              aria-expanded={expanded}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest">{tick.horizon}</span>
                <span className="rounded-full border border-current/30 bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  {driftLabel(tick.velocityDrift)}
                </span>
              </div>
              <p className="text-sm font-medium text-foreground">{tick.headline}</p>
              {expanded ? (
                <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                  {tick.trace.map((line, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-qep-orange">›</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tap for why</p>
              )}
            </button>
          );
        })}
      </div>
    </DeckSurface>
  );
}
