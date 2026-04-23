/**
 * Decision Room — recommended next moves.
 *
 * Deterministic. Given a board, emit the top 3 highest-leverage concrete
 * next moves the rep should make today. No model call — runs locally off
 * the board state so it stays fast and free, and every suggestion is
 * auditable back to the board facts that produced it.
 *
 * The move-proposal rules fire in priority order; the first three that
 * match win. Rules that reference specific seats include the seat id so
 * the UI can deep-link into the drawer.
 */
import type { DecisionRoomBoard } from "./decision-room-simulator";
import type { DecisionRoomSeat, SeatArchetype } from "./decision-room-archetype";

export type MoveLeverage = "high" | "medium" | "quick_win";

export interface RecommendedMove {
  id: string;
  leverage: MoveLeverage;
  title: string;
  rationale: string;
  /** Optional seat this move targets; lets the UI jump straight to its drawer. */
  seatId: string | null;
  /** A ready-to-try move string for the Try-a-move bar. */
  tryMovePrompt: string | null;
}

const LEVERAGE_RANK: Record<MoveLeverage, number> = {
  high: 0,
  medium: 1,
  quick_win: 2,
};

function highestPowerGhost(seats: DecisionRoomSeat[], archetype?: SeatArchetype): DecisionRoomSeat | null {
  const pool = seats.filter((s) => s.status === "ghost" && (!archetype || s.archetype === archetype));
  return pool.reduce<DecisionRoomSeat | null>((best, seat) => {
    if (!best) return seat;
    return seat.vetoWeight > best.vetoWeight ? seat : best;
  }, null);
}

function seatsOfArchetype(seats: DecisionRoomSeat[], archetype: SeatArchetype): DecisionRoomSeat[] {
  return seats.filter((s) => s.archetype === archetype);
}

export function buildRecommendedMoves(board: DecisionRoomBoard): RecommendedMove[] {
  const out: RecommendedMove[] = [];
  const { seats, scores } = board;

  // Rule 1: named blocker in the room → the oldest one first.
  const blocker = seats.find((s) => s.stance === "blocker" && s.status === "named");
  if (blocker) {
    out.push({
      id: "address-blocker",
      leverage: "high",
      title: `Address ${blocker.name ?? blocker.archetypeLabel} directly before anything else`,
      rationale: `${blocker.name ?? "This seat"} is an active blocker in the room. Moves made around them without addressing the concern will bounce.`,
      seatId: blocker.id,
      tryMovePrompt: `Meet with ${blocker.name ?? blocker.archetypeLabel} privately and surface their concern head-on`,
    });
  }

  // Rule 2: economic buyer is a ghost → name-capture is the single biggest play.
  const ebGhost = seats.find((s) => s.status === "ghost" && s.archetype === "economic_buyer");
  if (ebGhost) {
    const champion = seats.find((s) => s.archetype === "champion" && s.status === "named");
    out.push({
      id: "surface-economic-buyer",
      leverage: "high",
      title: champion?.name
        ? `Ask ${champion.name} who signs off on capex above their discretion`
        : "Surface the economic buyer — they own the signature",
      rationale: `The decision room has no named economic buyer but the archetype is expected on deals this size. Until you name this seat, the deal is resting on unknown capital authority.`,
      seatId: ebGhost.id,
      tryMovePrompt: "Ask the champion to introduce me to whoever signs off on capex",
    });
  }

  // Rule 3: operations is a ghost and a blocker signal exists → install-window risk.
  const opsGhost = seats.find((s) => s.status === "ghost" && s.archetype === "operations");
  if (opsGhost && scores.consensusRisk.level !== "low") {
    out.push({
      id: "surface-operations",
      leverage: "high",
      title: "Surface the operations / plant manager before pushing a close",
      rationale:
        "There's an active blocker signal and nobody in the room owns the install window. Operations will kill this at the 11th hour if they aren't brought in now.",
      seatId: opsGhost.id,
      tryMovePrompt: "Request a plant walkthrough with whoever owns install timing",
    });
  }

  // Rule 4: high latent veto from any non-EB ghost → get a name on it.
  if (out.length < 3 && scores.latentVeto.level === "high") {
    const topGhost = highestPowerGhost(seats);
    if (topGhost && !out.some((m) => m.seatId === topGhost.id)) {
      out.push({
        id: "reduce-latent-veto",
        leverage: "high",
        title: `Reduce veto risk from the ${topGhost.archetypeLabel} seat`,
        rationale: `${topGhost.archetypeLabel} is a ghost with the highest silent-veto power in this room. Give them something to say yes to before someone else hands them a reason to say no.`,
        seatId: topGhost.id,
        tryMovePrompt: `Schedule a short working session with whoever fills the ${topGhost.archetypeLabel.toLowerCase()} seat`,
      });
    }
  }

  // Rule 5: quote presented and consensus is ok → push for a signer touchpoint.
  if (out.length < 3) {
    const signer = seats.find((s) => s.status === "named" && s.stance === "champion" && s.vetoWeight >= 0.5);
    if (signer && scores.consensusRisk.level === "low") {
      out.push({
        id: "close-with-signer",
        leverage: "medium",
        title: `Lock a signing window with ${signer.name ?? signer.archetypeLabel}`,
        rationale:
          "The consensus inside the room is friendly and you already have a high-power champion. The cost of waiting here is a competitor surfacing a new quote.",
        seatId: signer.id,
        tryMovePrompt: `Propose a signing meeting with ${signer.name ?? signer.archetypeLabel} this week`,
      });
    }
  }

  // Rule 6: operators are silent and this is industrial → give them a voice.
  if (out.length < 3) {
    const hasNamedOperator = seatsOfArchetype(seats, "operator").some((s) => s.status === "named");
    if (!hasNamedOperator && board.dealName) {
      out.push({
        id: "operator-voice",
        leverage: "medium",
        title: "Give the operators a voice — they shape the uptime story",
        rationale:
          "No machine operator is in the room. Operators talk to each other across jobsites; their recommendation is the quiet multiplier on whether the sale turns into a long-term relationship.",
        seatId: null,
        tryMovePrompt: "Offer a demo day for the actual machine operators on this crew",
      });
    }
  }

  // Rule 7: overdue tasks → quick win, clean your own side of the room.
  if (out.length < 3 && scores.decisionVelocity.trace.some((t) => t.includes("overdue"))) {
    out.push({
      id: "clear-overdue",
      leverage: "quick_win",
      title: "Clear your overdue tasks on this deal before the next touchpoint",
      rationale:
        "Overdue tasks on your side are slowing the predicted close date. Clear them and you buy back days without talking to a single customer.",
      seatId: null,
      tryMovePrompt: null,
    });
  }

  // Rule 8: fallback quick win — confirm next step with the champion.
  if (out.length < 3) {
    const champion = seats.find((s) => s.status === "named" && (s.stance === "champion" || s.archetype === "champion"));
    if (champion) {
      out.push({
        id: "confirm-next-step",
        leverage: "quick_win",
        title: `Confirm the next step in writing with ${champion.name ?? "your champion"}`,
        rationale:
          "Nothing is on fire here, but deals drift when the next step stops being explicit. A 90-second email captures it.",
        seatId: champion.id,
        tryMovePrompt: null,
      });
    }
  }

  // Sort by leverage rank then dedupe any accidental repeats by id.
  const sorted = out.sort((a, b) => LEVERAGE_RANK[a.leverage] - LEVERAGE_RANK[b.leverage]);
  const seen = new Set<string>();
  const deduped: RecommendedMove[] = [];
  for (const move of sorted) {
    if (seen.has(move.id)) continue;
    seen.add(move.id);
    deduped.push(move);
    if (deduped.length >= 3) break;
  }
  return deduped;
}
