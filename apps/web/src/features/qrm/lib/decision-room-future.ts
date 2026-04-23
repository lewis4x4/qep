/**
 * Decision Room — future-state projector.
 *
 * Deterministic simulation of how the room drifts if nothing is done.
 * No model call. The rules encode the standard equipment-sale decay
 * patterns: unfilled high-power seats accrue risk, old quotes lose
 * velocity, blockers compound, budget cycles close.
 *
 * Later phases (Phase 4 full scrubber) will replace this with
 * workspace-trained coefficients from historical deals. Same output
 * shape so the UI doesn't change.
 */
import type { DecisionRoomBoard } from "./decision-room-simulator";

export type FutureHorizon = "7d" | "14d" | "30d";

export interface FutureTick {
  horizon: FutureHorizon;
  /** Signed days added to the current velocity at this horizon. */
  velocityDrift: number;
  /** One-line headline describing the shift. */
  headline: string;
  /** Trace bullets showing what produced the drift. */
  trace: string[];
}

const HORIZON_DAYS: Record<FutureHorizon, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

export function projectFutureState(board: DecisionRoomBoard, horizon: FutureHorizon): FutureTick {
  const days = HORIZON_DAYS[horizon];
  const trace: string[] = [];
  let drift = 0;

  const highPowerGhosts = board.seats.filter((s) => s.status === "ghost" && s.vetoWeight >= 0.6);
  if (highPowerGhosts.length > 0) {
    const add = highPowerGhosts.length * Math.round(days / 7);
    drift += add;
    trace.push(
      `+${add}d — ${highPowerGhosts.length} high-veto ghost${highPowerGhosts.length === 1 ? "" : "s"} left unfilled for ${days} day${days === 1 ? "" : "s"}`,
    );
  }

  const blockers = board.seats.filter((s) => s.stance === "blocker");
  if (blockers.length > 0) {
    const add = blockers.length * Math.round((days / 7) * 2);
    drift += add;
    trace.push(
      `+${add}d — ${blockers.length} seated blocker${blockers.length === 1 ? "" : "s"} compounds without direct outreach`,
    );
  }

  if (board.scores.coverage.value < 0.5) {
    const add = Math.round(days / 10);
    drift += add;
    trace.push(`+${add}d — coverage still under 50%, more stakeholders surface late`);
  }

  // If consensus risk is already high, delays of 14d+ usually see a competitor quote land.
  if (board.scores.consensusRisk.level === "high" && days >= 14) {
    drift += 5;
    trace.push("+5d — at this consensus risk, competitor re-quote usually lands by day 14");
  }

  // Budget-cycle tax: at 30d+, finance seats re-prioritize capex internally.
  if (days >= 30 && board.scores.latentVeto.level === "high") {
    drift += 4;
    trace.push("+4d — economic buyer's budget cycle typically re-prioritizes capex by 30d");
  }

  // Headline summarization.
  let headline: string;
  if (drift === 0) {
    headline = `Holds steady through ${horizon} — low drift signal`;
  } else if (drift <= 3) {
    headline = `Mild drift — +${drift}d to close by ${horizon}`;
  } else if (drift <= 8) {
    headline = `Notable slide — +${drift}d to close by ${horizon}`;
  } else {
    headline = `Material slippage — +${drift}d to close by ${horizon}; hard to recover without a move`;
  }

  if (trace.length === 0) {
    trace.push("No risky seats or stances accumulated signal over this horizon");
  }

  return {
    horizon,
    velocityDrift: drift,
    headline,
    trace,
  };
}

export function projectAllHorizons(board: DecisionRoomBoard): FutureTick[] {
  return (["7d", "14d", "30d"] as FutureHorizon[]).map((h) => projectFutureState(board, h));
}
