/**
 * Decision Room — scoreboard.
 *
 * Four scores replace the old count tiles:
 *   - Decision Velocity  — predicted days-to-close on current evidence
 *   - Coverage           — % of expected seats that have at least one signal
 *   - Consensus Risk     — how likely the room disagrees
 *   - Latent Veto Power  — probability a currently-silent seat can kill it
 *
 * Every score carries a trace so the rep can click and see why. No opaque
 * numbers. Phase 4 (time scrubber) will replace the deterministic models
 * below with ones that re-score the room at future timestamps; Phase 3
 * (ghost inference) will tighten coverage using workspace archetypes. The
 * output shape is stable so those upgrades don't force UI changes.
 */
import type {
  ConfidenceLevel,
  DecisionRoomSeat,
  SeatArchetype,
  SeatStance,
} from "./decision-room-archetype";

export interface DecisionVelocityScore {
  /** Days until predicted close. Can be negative (already past due). */
  days: number | null;
  confidence: ConfidenceLevel;
  /** Human-readable reasons this number came out the way it did. */
  trace: string[];
}

export interface CoverageScore {
  /** 0..1 — portion of expected seats with at least one evidence signal. */
  value: number;
  filled: number;
  expected: number;
  missingArchetypes: SeatArchetype[];
  trace: string[];
}

export interface ConsensusRiskScore {
  level: ConfidenceLevel;
  trace: string[];
}

export interface LatentVetoScore {
  level: ConfidenceLevel;
  topGhostArchetype: SeatArchetype | null;
  trace: string[];
}

export interface DecisionRoomScores {
  decisionVelocity: DecisionVelocityScore;
  coverage: CoverageScore;
  consensusRisk: ConsensusRiskScore;
  latentVeto: LatentVetoScore;
}

export interface ScoringInput {
  seats: DecisionRoomSeat[];
  expectedArchetypes: SeatArchetype[];
  expectedCloseOn: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  pendingApprovalCount: number;
  quotePresented: boolean;
  blockerPresent: boolean;
  now?: Date;
}

function daysUntil(targetIso: string | null, now: Date): number | null {
  if (!targetIso) return null;
  const parsed = Date.parse(targetIso);
  if (!Number.isFinite(parsed)) return null;
  const diffMs = parsed - now.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function scoreDecisionVelocity(input: ScoringInput): DecisionVelocityScore {
  const now = input.now ?? new Date();
  const baseline = daysUntil(input.expectedCloseOn, now);
  const trace: string[] = [];

  let adjust = 0;

  const blockers = input.seats.filter((s) => s.stance === "blocker");
  if (blockers.length > 0) {
    const bump = blockers.length * 5;
    adjust += bump;
    trace.push(`+${bump}d — ${blockers.length} seated blocker${blockers.length === 1 ? "" : "s"}`);
  }

  const highValueGhosts = input.seats.filter(
    (s) => s.status === "ghost" && s.vetoWeight >= 0.6,
  );
  if (highValueGhosts.length > 0) {
    const bump = highValueGhosts.length * 3;
    adjust += bump;
    trace.push(
      `+${bump}d — ${highValueGhosts.length} high-influence ghost seat${highValueGhosts.length === 1 ? "" : "s"}`,
    );
  }

  if (input.overdueTaskCount > 0) {
    const bump = Math.min(input.overdueTaskCount * 2, 10);
    adjust += bump;
    trace.push(`+${bump}d — ${input.overdueTaskCount} overdue task${input.overdueTaskCount === 1 ? "" : "s"}`);
  }

  if (input.pendingApprovalCount > 0) {
    const bump = input.pendingApprovalCount * 2;
    adjust += bump;
    trace.push(
      `+${bump}d — ${input.pendingApprovalCount} pending approval${input.pendingApprovalCount === 1 ? "" : "s"}`,
    );
  }

  if (input.quotePresented) {
    adjust -= 4;
    trace.push(`-4d — a quote has already been presented`);
  }

  let days: number | null = null;
  let confidence: ConfidenceLevel = "low";

  if (baseline != null) {
    days = baseline + adjust;
    confidence = input.seats.length >= 3 ? "medium" : "low";
    if (input.quotePresented && blockers.length === 0 && highValueGhosts.length <= 1) {
      confidence = "high";
    }
    trace.unshift(`Baseline ${baseline}d from expected close date`);
  } else {
    trace.unshift("No expected close date on the deal yet");
    if (adjust !== 0) {
      days = adjust;
      confidence = "low";
    }
  }

  return { days, confidence, trace };
}

function scoreCoverage(input: ScoringInput): CoverageScore {
  const expected = input.expectedArchetypes;
  const coveredArchetypes = new Set<SeatArchetype>();
  for (const seat of input.seats) {
    if (seat.status === "named") {
      coveredArchetypes.add(seat.archetype);
    }
  }

  const filled = expected.filter((a) => coveredArchetypes.has(a)).length;
  const value = expected.length === 0 ? 0 : filled / expected.length;
  const missing = expected.filter((a) => !coveredArchetypes.has(a));

  const trace: string[] = [];
  trace.push(`${filled} of ${expected.length} expected seats are named`);
  if (missing.length > 0) {
    trace.push(`Missing: ${missing.join(", ")}`);
  } else {
    trace.push("Every expected archetype has at least one named contact");
  }

  return { value, filled, expected: expected.length, missingArchetypes: missing, trace };
}

function stanceConflict(stances: SeatStance[]): boolean {
  const hasFriendly = stances.includes("champion");
  const hasHostile = stances.includes("blocker") || stances.includes("skeptical");
  return hasFriendly && hasHostile;
}

function scoreConsensusRisk(input: ScoringInput): ConsensusRiskScore {
  const trace: string[] = [];
  const blockers = input.seats.filter((s) => s.stance === "blocker" && s.status === "named");
  if (blockers.length > 0) {
    trace.push(
      `${blockers.length} named blocker${blockers.length === 1 ? "" : "s"} in the room (${blockers
        .map((b) => b.name)
        .filter(Boolean)
        .join(", ")})`,
    );
  }

  const byArchetype = new Map<SeatArchetype, SeatStance[]>();
  for (const seat of input.seats) {
    if (seat.status !== "named") continue;
    const list = byArchetype.get(seat.archetype) ?? [];
    list.push(seat.stance);
    byArchetype.set(seat.archetype, list);
  }
  const conflicting = Array.from(byArchetype.entries()).filter(([, stances]) => stanceConflict(stances));
  if (conflicting.length > 0) {
    trace.push(
      `Stance conflict on ${conflicting.length} archetype${conflicting.length === 1 ? "" : "s"}: ${conflicting
        .map(([a]) => a)
        .join(", ")}`,
    );
  }

  const highPowerUnknowns = input.seats.filter(
    (s) => s.stance === "unknown" && s.powerWeight >= 0.7,
  );
  if (highPowerUnknowns.length > 0) {
    trace.push(
      `${highPowerUnknowns.length} high-influence seat${highPowerUnknowns.length === 1 ? "" : "s"} have no stance yet`,
    );
  }

  let level: ConfidenceLevel = "low";
  if (blockers.length > 0 || conflicting.length > 0) {
    level = "high";
  } else if (highPowerUnknowns.length >= 2) {
    level = "medium";
  } else if (highPowerUnknowns.length === 1) {
    level = "medium";
  }

  if (trace.length === 0) {
    trace.push("Every named seat leans friendly or neutral");
  }

  return { level, trace };
}

function scoreLatentVeto(input: ScoringInput): LatentVetoScore {
  const ghosts = input.seats.filter((s) => s.status === "ghost");
  let top: DecisionRoomSeat | null = null;
  for (const ghost of ghosts) {
    if (!top || ghost.vetoWeight > top.vetoWeight) {
      top = ghost;
    }
  }

  const trace: string[] = [];
  if (!top) {
    trace.push("No ghost seats — every expected seat is named");
    return { level: "low", topGhostArchetype: null, trace };
  }

  const label = top.name ? `${top.name} (${top.archetypeLabel})` : top.archetypeLabel;
  trace.push(`Highest silent veto risk: ${label}`);
  if (top.findGuidance) {
    trace.push(top.findGuidance.reason);
  }

  let level: ConfidenceLevel;
  if (top.vetoWeight >= 0.8) {
    level = "high";
  } else if (top.vetoWeight >= 0.5) {
    level = "medium";
  } else {
    level = "low";
  }

  return { level, topGhostArchetype: top.archetype, trace };
}

export function buildScores(input: ScoringInput): DecisionRoomScores {
  return {
    decisionVelocity: scoreDecisionVelocity(input),
    coverage: scoreCoverage(input),
    consensusRisk: scoreConsensusRisk(input),
    latentVeto: scoreLatentVeto(input),
  };
}
