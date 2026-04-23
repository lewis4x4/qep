/**
 * DecisionRoomMoveHistory — scrollable list of past moves with their
 * per-seat reactions and aggregate verdict. Most recent first. Clicking
 * a move expands to show the reactions in detail.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Minus, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeckSurface } from "./command-deck";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";
import type { TriedMove } from "./DecisionRoomMoveBar";

interface Props {
  history: TriedMove[];
  seats: DecisionRoomSeat[];
  onPickSeat: (seat: DecisionRoomSeat) => void;
}

function moodCls(mood: TriedMove["aggregate"]["mood"]): string {
  switch (mood) {
    case "positive": return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
    case "negative": return "border-red-400/40 bg-red-500/10 text-red-200";
    default: return "border-amber-400/40 bg-amber-400/10 text-amber-200";
  }
}

function sentimentIcon(sentiment: string): React.ReactNode {
  if (sentiment === "positive") return <ThumbsUp className="h-3.5 w-3.5 text-emerald-300" aria-hidden />;
  if (sentiment === "negative") return <ThumbsDown className="h-3.5 w-3.5 text-red-300" aria-hidden />;
  return <Minus className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
}

function sentimentBorder(sentiment: string): string {
  if (sentiment === "positive") return "border-emerald-400/30 bg-emerald-400/[0.06]";
  if (sentiment === "negative") return "border-red-400/30 bg-red-500/[0.06]";
  return "border-amber-400/30 bg-amber-400/[0.04]";
}

function deltaLabel(days: number): string {
  if (days === 0) return "No change";
  return days > 0 ? `+${days}d slower` : `${Math.abs(days)}d faster`;
}

export function DecisionRoomMoveHistory({ history, seats, onPickSeat }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(history[0]?.moveId ?? null);
  const seatsById = new Map(seats.map((s) => [s.id, s]));

  if (history.length === 0) return null;

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Move history
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {history.length} move{history.length === 1 ? "" : "s"} tried
        </span>
      </div>
      <ol className="space-y-2">
        {history.map((move) => {
          const expanded = expandedId === move.moveId;
          return (
            <li key={move.moveId} className="rounded-lg border border-qep-deck-rule bg-qep-deck-elevated/60">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : move.moveId)}
                className="flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-white/[0.02]"
                aria-expanded={expanded}
              >
                <span className="mt-0.5 text-muted-foreground">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{move.move}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        moodCls(move.aggregate.mood),
                      )}
                    >
                      {move.aggregate.mood}
                    </span>
                    <span>{deltaLabel(move.aggregate.velocityDelta)}</span>
                    <span>·</span>
                    <span>{move.aggregate.summary}</span>
                  </div>
                </div>
              </button>
              {expanded ? (
                <ul className="space-y-2 border-t border-qep-deck-rule/60 p-3">
                  {move.reactions.map((reaction) => {
                    const seat = seatsById.get(reaction.seatId);
                    const seatLabel = seat
                      ? seat.name ?? `Probable ${seat.archetypeLabel}`
                      : reaction.seatId;
                    return (
                      <li
                        key={reaction.seatId}
                        className={cn(
                          "rounded-md border p-3 text-xs",
                          sentimentBorder(reaction.sentiment),
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-semibold text-foreground">
                            {sentimentIcon(reaction.sentiment)}
                            {seat ? (
                              <button
                                type="button"
                                onClick={() => onPickSeat(seat)}
                                className="text-left hover:text-qep-orange hover:underline"
                              >
                                {seatLabel}
                              </button>
                            ) : (
                              <span>{seatLabel}</span>
                            )}
                            {seat ? (
                              <span className="text-[10px] font-medium text-muted-foreground">
                                · {seat.archetypeLabel}
                              </span>
                            ) : null}
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {reaction.confidence} confidence
                          </span>
                        </div>
                        {reaction.concern ? (
                          <p className="text-foreground/90">{reaction.concern}</p>
                        ) : null}
                        {reaction.likelyNext ? (
                          <p className="mt-1 text-muted-foreground">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-qep-orange/80">
                              Next:
                            </span>{" "}
                            {reaction.likelyNext}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </DeckSurface>
  );
}
