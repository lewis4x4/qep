/**
 * DecisionRoomCanvas — the top-down conference-table view.
 *
 * Seats orbit a central table. Named seats have solid rings; ghosts have
 * dashed outlines. Size scales with powerWeight (economic buyers look bigger
 * than operators). Color tone reflects stance (champion green, blocker red,
 * unknown amber). Click any seat → fires onSelectSeat for the page to open
 * the drawer. This is the stage for Phase 2 (per-seat reaction bubbles)
 * and Phase 4 (time-scrubber animation).
 *
 * Responsive model: the canvas is aspect-ratio based so seat positions
 * scale together. Seat sizes clamp between a mobile floor and desktop
 * ceiling so they never collide on narrow screens.
 */
import { useMemo, useRef } from "react";
import type { DecisionRoomSeat } from "../lib/decision-room-simulator";
import { ARCHETYPE_AVATAR } from "../lib/decision-room-avatar";
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
    // Stretch x more than y — conference-table feel. Keep within 5–95%
    // so seats never clip the container at any viewport size.
    const xPct = 50 + Math.cos(angle) * 37;
    const yPct = 50 + Math.sin(angle) * 30;
    return { seat, xPct, yPct };
  });
}

/** Influence arrows: visualize the power graph inside the room. Each arrow
 *  runs from a champion to a higher-power seat they plausibly influence.
 *  Ghost seats never draw influence arrows (we don't know the graph yet). */
function influenceEdges(positions: SeatPosition[]): Array<{ fromIdx: number; toIdx: number }> {
  const edges: Array<{ fromIdx: number; toIdx: number }> = [];
  positions.forEach(({ seat }, fromIdx) => {
    if (seat.status !== "named") return;
    if (seat.archetype !== "champion" && seat.stance !== "champion") return;
    // Influence flows toward the highest-power named decider / economic buyer.
    let bestIdx = -1;
    let bestWeight = seat.powerWeight;
    positions.forEach(({ seat: target }, targetIdx) => {
      if (targetIdx === fromIdx) return;
      if (target.status !== "named") return;
      if (target.archetype !== "economic_buyer" && target.archetype !== "operations" && target.archetype !== "executive_sponsor") {
        return;
      }
      if (target.powerWeight > bestWeight) {
        bestIdx = targetIdx;
        bestWeight = target.powerWeight;
      }
    });
    if (bestIdx >= 0) edges.push({ fromIdx, toIdx: bestIdx });
  });
  return edges;
}

function initials(seat: DecisionRoomSeat): string {
  if (seat.status === "ghost" && !seat.name) return "?";
  const source = seat.name ?? seat.archetypeLabel;
  const words = source.split(/\s+/).filter(Boolean);
  const primary = words[0]?.[0] ?? "?";
  const secondary = words[1]?.[0] ?? "";
  return (primary + secondary).toUpperCase();
}

/**
 * Seat diameter in px, clamped so even 8+ seats never overlap on mobile.
 * Mobile floor: 40px. Desktop ceiling: 76px. Power weight scales inside.
 */
function sizeForPower(weight: number): string {
  const floor = 40;
  const range = 28; // + up to 28 on desktop
  const base = Math.round(floor + weight * range);
  // clamp(min, preferred, max) — preferred scales with viewport.
  return `clamp(${floor}px, ${base * 0.85}px + 0.5vw, ${base + 8}px)`;
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
  const edges = useMemo(() => influenceEdges(positioned), [positioned]);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  function focusSeatAt(index: number) {
    if (seats.length === 0) return;
    const safeIndex = ((index % seats.length) + seats.length) % seats.length;
    const target = seats[safeIndex];
    const el = target ? buttonRefs.current.get(target.id) : null;
    el?.focus();
  }

  function handleSeatKey(event: React.KeyboardEvent, seatIndex: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusSeatAt(seatIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSeatAt(seatIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusSeatAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusSeatAt(seats.length - 1);
    }
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-qep-deck-rule bg-gradient-to-b from-qep-deck-elevated/60 to-black/60">
      {/* Decorative grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Radial glow anchored to table */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 50%, hsl(var(--qep-orange) / 0.08), transparent 70%)",
        }}
      />

      {/* Aspect-ratio wrapper keeps seat angles consistent across viewports. */}
      <div className="relative aspect-[16/10] min-h-[380px] w-full sm:min-h-[440px]">
        {/* Influence arrows — light SVG lines from champions toward the
            highest-power decider they plausibly influence. */}
        {edges.length > 0 ? (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <marker
                id="decision-room-influence-arrow"
                viewBox="0 0 6 6"
                refX="5"
                refY="3"
                markerWidth="3"
                markerHeight="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 z" fill="hsl(var(--qep-orange) / 0.45)" />
              </marker>
            </defs>
            {edges.map(({ fromIdx, toIdx }, i) => {
              const from = positioned[fromIdx];
              const to = positioned[toIdx];
              if (!from || !to) return null;
              const fromLabel = from.seat.name ?? from.seat.archetypeLabel;
              const toLabel = to.seat.name ?? to.seat.archetypeLabel;
              return (
                <line
                  key={`${fromIdx}-${toIdx}-${i}`}
                  x1={from.xPct}
                  y1={from.yPct}
                  x2={to.xPct}
                  y2={to.yPct}
                  stroke="hsl(var(--qep-orange) / 0.35)"
                  strokeWidth="0.25"
                  strokeDasharray="0.7 0.6"
                  vectorEffect="non-scaling-stroke"
                  markerEnd="url(#decision-room-influence-arrow)"
                  className="pointer-events-auto cursor-help transition-[stroke-width,stroke] hover:stroke-[0.5] hover:stroke-qep-orange"
                  role="presentation"
                >
                  <title>{`${fromLabel} champions ${toLabel}`}</title>
                </line>
              );
            })}
          </svg>
        ) : null}
        {/* The table — an oval in the center of the canvas */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01]"
          style={{ width: "46%", height: "42%" }}
        >
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-qep-orange/70">
              Decision Room
            </p>
            <p className="mt-1 line-clamp-2 text-sm font-semibold text-foreground/90 md:text-base">
              {dealName ?? "Untitled deal"}
            </p>
            {companyName ? (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{companyName}</p>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-qep-live shadow-[0_0_8px_hsl(var(--qep-live))]" />
              Live seat map
            </div>
          </div>
        </div>

        {/* Seats — roving tabindex: one seat is tab-focusable at a time,
            arrows move focus between the rest. Use the selected seat when
            one is picked, otherwise the first seat. */}
        {positioned.map(({ seat, xPct, yPct }, index) => {
          const size = sizeForPower(seat.powerWeight);
          const tone = stanceTone(seat);
          const selected = selectedSeatId === seat.id;
          const rovingAnchor = selectedSeatId
            ? selectedSeatId === seat.id
            : index === 0;

          return (
            <button
              key={seat.id}
              ref={(el) => {
                if (el) buttonRefs.current.set(seat.id, el);
                else buttonRefs.current.delete(seat.id);
              }}
              type="button"
              onClick={() => onSelectSeat(seat)}
              onKeyDown={(event) => handleSeatKey(event, index)}
              className={cn(
                "group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-transform duration-150",
                "hover:scale-105 focus-visible:scale-105 focus-visible:outline-none",
              )}
              style={{ left: `${xPct}%`, top: `${yPct}%`, width: 108 }}
              aria-label={`${seat.name ?? `${seat.archetypeLabel} (ghost)`} — ${seat.archetypeLabel}`}
              aria-pressed={selected}
              tabIndex={rovingAnchor ? 0 : -1}
            >
              <div className="relative">
                <div
                  className={cn(
                    "relative flex items-center justify-center overflow-hidden rounded-full border-2 ring-2 ring-offset-0",
                    tone.ring,
                    tone.bg,
                    tone.glow,
                    tone.text,
                    selected && "ring-4 ring-qep-orange/80",
                  )}
                  style={{ width: size, height: size }}
                >
                  {seat.status === "ghost" && ARCHETYPE_AVATAR[seat.archetype] ? (
                    <>
                      <img
                        src={ARCHETYPE_AVATAR[seat.archetype]}
                        alt=""
                        aria-hidden
                        className="absolute inset-0 h-full w-full object-cover opacity-80 saturate-[0.55] transition-[filter,opacity] duration-200 group-hover:opacity-100 group-hover:saturate-100 group-focus-visible:opacity-100 group-focus-visible:saturate-100"
                        draggable={false}
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/50"
                      />
                    </>
                  ) : (
                    <span className="text-sm font-semibold sm:text-base">{initials(seat)}</span>
                  )}
                </div>
                {/* Ghost / blocker badge — floats fully above the circle so
                    it never covers the archetype portrait. Blocker wins if
                    both apply. */}
                {seat.stance === "blocker" ? (
                  <span
                    aria-hidden
                    className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-red-400/60 bg-black/85 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-red-300 shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                  >
                    Blocker
                  </span>
                ) : seat.status === "ghost" ? (
                  <span
                    aria-hidden
                    className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-qep-orange/60 bg-black/85 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider text-qep-orange shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                  >
                    Ghost
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 max-w-full text-center">
                <p className="truncate text-[11px] font-medium text-foreground/90">
                  {seat.name ?? (seat.status === "ghost" ? "Not yet identified" : "—")}
                </p>
                <p
                  className={cn(
                    "truncate text-[10px]",
                    seat.status === "ghost" ? "italic text-muted-foreground" : "text-muted-foreground",
                  )}
                >
                  {seat.archetypeLabel}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
