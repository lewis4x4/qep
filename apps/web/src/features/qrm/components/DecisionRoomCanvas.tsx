/**
 * DecisionRoomCanvas — the top-down conference-table view.
 *
 * Seats orbit a central table. Named seats have solid rings; ghosts have
 * dashed outlines. Size scales with powerWeight (economic buyers look bigger
 * than operators). Color tone reflects stance (champion green, blocker red,
 * unknown amber). Click any seat → fires onSelectSeat for the page to open
 * the drawer. This is the stage for Phase 2 (per-seat reaction bubbles)
 * and Phase 4 (time-scrubber animation).
 */
import { useMemo } from "react";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";
import { cn } from "@/lib/utils";

interface Props {
  seats: DecisionRoomSeat[];
  selectedSeatId: string | null;
  onSelectSeat: (seat: DecisionRoomSeat) => void;
  companyName: string | null;
  dealName: string | null;
}

interface SeatPosition {
  seat: DecisionRoomSeat;
  xPct: number;
  yPct: number;
}

/** Oval arrangement — seats distributed around a horizontally-stretched ellipse. */
function placeSeats(seats: DecisionRoomSeat[]): SeatPosition[] {
  const n = Math.max(seats.length, 1);
  return seats.map((seat, i) => {
    // Start at the top (–π/2) and walk clockwise so the first/highest-power
    // seat is at the head of the table.
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    // Stretch x more than y — conference-table feel.
    const xPct = 50 + Math.cos(angle) * 38;
    const yPct = 50 + Math.sin(angle) * 28;
    return { seat, xPct, yPct };
  });
}

function initials(seat: DecisionRoomSeat): string {
  if (seat.status === "ghost" && !seat.name) return "?";
  const source = seat.name ?? seat.archetypeLabel;
  const words = source.split(/\s+/).filter(Boolean);
  const primary = words[0]?.[0] ?? "?";
  const secondary = words[1]?.[0] ?? "";
  return (primary + secondary).toUpperCase();
}

function sizeForPower(weight: number): number {
  // 48px at weight 0, 80px at weight 1
  return Math.round(48 + weight * 32);
}

function stanceTone(seat: DecisionRoomSeat): { ring: string; bg: string; glow: string; text: string } {
  if (seat.status === "ghost") {
    return {
      ring: "ring-white/25 border-dashed border-white/20",
      bg: "bg-white/[0.03]",
      glow: "",
      text: "text-white/60",
    };
  }
  switch (seat.stance) {
    case "champion":
      return {
        ring: "ring-emerald-400/60 border-emerald-400/40",
        bg: "bg-emerald-400/10",
        glow: "shadow-[0_0_24px_hsl(150_80%_45%/0.35)]",
        text: "text-emerald-100",
      };
    case "blocker":
      return {
        ring: "ring-red-400/70 border-red-400/50",
        bg: "bg-red-500/10",
        glow: "shadow-[0_0_24px_hsl(0_80%_55%/0.4)]",
        text: "text-red-100",
      };
    case "skeptical":
      return {
        ring: "ring-amber-400/60 border-amber-400/40",
        bg: "bg-amber-400/10",
        glow: "shadow-[0_0_18px_hsl(40_90%_55%/0.3)]",
        text: "text-amber-100",
      };
    case "neutral":
      return {
        ring: "ring-qep-orange/50 border-qep-orange/40",
        bg: "bg-qep-orange/10",
        glow: "shadow-[0_0_18px_hsl(var(--qep-orange)/0.3)]",
        text: "text-foreground",
      };
    default:
      return {
        ring: "ring-white/30 border-white/30",
        bg: "bg-white/[0.04]",
        glow: "",
        text: "text-white/70",
      };
  }
}

export function DecisionRoomCanvas({ seats, selectedSeatId, onSelectSeat, companyName, dealName }: Props) {
  const positioned = useMemo(() => placeSeats(seats), [seats]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-qep-deck-rule bg-gradient-to-b from-qep-deck-elevated/60 to-black/60">
      {/* Decorative grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Radial glow anchored to table */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(60% 50% at 50% 50%, hsl(var(--qep-orange) / 0.08), transparent 70%)",
        }}
      />

      <div className="relative h-[460px] w-full">
        {/* The table — an oval in the center of the canvas */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01]"
          style={{ width: "48%", height: "40%" }}
        >
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-qep-orange/70">
              Decision Room
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground/90 md:text-base">
              {dealName ?? "Untitled deal"}
            </p>
            {companyName ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{companyName}</p>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-qep-live shadow-[0_0_8px_hsl(var(--qep-live))]" />
              Live seat map
            </div>
          </div>
        </div>

        {/* Seats */}
        {positioned.map(({ seat, xPct, yPct }) => {
          const size = sizeForPower(seat.powerWeight);
          const tone = stanceTone(seat);
          const selected = selectedSeatId === seat.id;

          return (
            <button
              key={seat.id}
              type="button"
              onClick={() => onSelectSeat(seat)}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-150",
                "hover:scale-110 focus-visible:scale-110 focus-visible:outline-none",
              )}
              style={{ left: `${xPct}%`, top: `${yPct}%` }}
              aria-label={`${seat.name ?? "Ghost seat"} — ${seat.archetypeLabel}`}
            >
              <div
                className={cn(
                  "flex items-center justify-center rounded-full border-2 ring-2 ring-offset-0",
                  tone.ring,
                  tone.bg,
                  tone.glow,
                  tone.text,
                  selected && "ring-4 ring-qep-orange/80",
                )}
                style={{ width: size, height: size }}
              >
                <span className={cn("font-semibold", size >= 64 ? "text-base" : "text-sm")}>
                  {initials(seat)}
                </span>
              </div>
              {/* Label below seat */}
              <div className="mt-2 w-[112px] -translate-x-[calc(50%-calc(var(--seat-size,0px)/2))] text-center">
                <p className="truncate text-[11px] font-medium text-foreground/90" style={{ maxWidth: 112 }}>
                  {seat.name ?? (seat.status === "ghost" ? "Unknown" : "—")}
                </p>
                <p
                  className={cn(
                    "truncate text-[10px]",
                    seat.status === "ghost" ? "italic text-muted-foreground" : "text-muted-foreground",
                  )}
                  style={{ maxWidth: 112 }}
                >
                  {seat.archetypeLabel}
                </p>
              </div>
              {/* Ghost indicator */}
              {seat.status === "ghost" ? (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 rounded-full border border-qep-orange/60 bg-black/80 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-qep-orange"
                >
                  Ghost
                </span>
              ) : null}
              {/* Blocker indicator */}
              {seat.stance === "blocker" ? (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 rounded-full border border-red-400/60 bg-black/80 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-red-300"
                >
                  Blocker
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
