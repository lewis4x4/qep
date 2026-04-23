/**
 * DecisionRoomRecommendedMoves — the "now what?" panel.
 *
 * Three concrete, ranked actions generated deterministically from the board.
 * Click one: it jumps to the relevant seat drawer (when applicable) AND
 * pre-fills the try-a-move bar with a ready-to-run move string.
 */
import { ArrowRight, Sparkles, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeckSurface } from "./command-deck";
import type { MoveLeverage, RecommendedMove } from "../lib/decision-room-moves";

interface Props {
  moves: RecommendedMove[];
  onPickMove: (move: RecommendedMove) => void;
}

const LEVERAGE_META: Record<MoveLeverage, { label: string; icon: React.ReactNode; cls: string }> = {
  high: {
    label: "High leverage",
    icon: <Zap className="h-3.5 w-3.5" />,
    cls: "border-red-400/40 bg-red-500/10 text-red-200",
  },
  medium: {
    label: "Medium",
    icon: <Target className="h-3.5 w-3.5" />,
    cls: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  },
  quick_win: {
    label: "Quick win",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
};

export function DecisionRoomRecommendedMoves({ moves, onPickMove }: Props) {
  if (moves.length === 0) return null;

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-qep-orange" aria-hidden />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Recommended moves
        </h2>
      </div>
      <ul className="grid gap-2 md:grid-cols-3">
        {moves.map((move) => {
          const meta = LEVERAGE_META[move.leverage];
          return (
            <li key={move.id}>
              <button
                type="button"
                onClick={() => onPickMove(move)}
                className={cn(
                  "group flex h-full w-full flex-col gap-2 rounded-xl border border-qep-deck-rule bg-qep-deck-elevated/60 p-4 text-left",
                  "transition-colors hover:border-qep-orange/40 focus-visible:border-qep-orange/60 focus-visible:outline-none",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      meta.cls,
                    )}
                  >
                    {meta.icon}
                    {meta.label}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
                </div>
                <p className="text-sm font-medium text-foreground">{move.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{move.rationale}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </DeckSurface>
  );
}
