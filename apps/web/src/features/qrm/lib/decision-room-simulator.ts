/**
 * Decision Room Simulator — board builder.
 *
 * This is the Phase 1 entry point: it turns the CRM+voice+signature
 * evidence for a deal into a full seat map (named + ghost) and a scoreboard
 * (velocity, coverage, consensus risk, latent veto). The output is the
 * single source of truth rendered by DecisionRoomSimulatorPage.
 *
 * Extension points for later phases:
 *   - Phase 2 (try-a-move): add a `reactions?: Record<seatId, Reaction>`
 *     field alongside seats. The edge fn writes it after each move.
 *   - Phase 3 (ghost inference): `findGuidance` on ghost seats is already
 *     structured for Tavily / exec-title enrichment — just fill the fields
 *     from the edge fn response.
 *   - Phase 4 (time scrubber): pass a `simulationTime` param; buildSeats
 *     and buildScores both take the timestamp and re-evaluate.
 *   - Phase 5 (loss gym): snapshots can be persisted and rehydrated into
 *     this same shape via decision_room_snapshots rows.
 */
import type { NeedsAssessment } from "./deal-composite-types";
import type { RelationshipMapBoard } from "./relationship-map";
import {
  buildSeats,
  type DecisionRoomSeat,
  type SeatArchetype,
} from "./decision-room-archetype";
import { buildScores, type DecisionRoomScores } from "./decision-room-scoring";

export type {
  DecisionRoomSeat,
  SeatArchetype,
  SeatStance,
  SeatStatus,
  SeatEvidence,
  GhostFindGuidance,
  ConfidenceLevel,
} from "./decision-room-archetype";
export {
  ARCHETYPE_DEFS,
  inferArchetypeForContact,
  buildSeats,
} from "./decision-room-archetype";
export type {
  DecisionRoomScores,
  DecisionVelocityScore,
  CoverageScore,
  ConsensusRiskScore,
  LatentVetoScore,
} from "./decision-room-scoring";

export interface DecisionRoomBoard {
  dealId: string;
  companyName: string | null;
  dealName: string | null;
  seats: DecisionRoomSeat[];
  expectedArchetypes: SeatArchetype[];
  scores: DecisionRoomScores;
  snapshotAt: string;
}

export interface BuildDecisionRoomBoardInput {
  dealId: string;
  dealName: string | null;
  dealAmount: number | null;
  expectedCloseOn: string | null;
  companyName: string | null;
  relationship: RelationshipMapBoard;
  needsAssessment: NeedsAssessment | null;
  blockerPresent: boolean;
  openTaskCount: number;
  overdueTaskCount: number;
  pendingApprovalCount: number;
  quotePresented: boolean;
  now?: Date;
}

export function buildDecisionRoomBoard(input: BuildDecisionRoomBoardInput): DecisionRoomBoard {
  const now = input.now ?? new Date();

  const { seats, expectedArchetypes } = buildSeats({
    relationship: input.relationship,
    needsAssessment: input.needsAssessment,
    companyName: input.companyName,
    dealAmount: input.dealAmount,
    blockerPresent: input.blockerPresent,
  });

  const scores = buildScores({
    seats,
    expectedArchetypes,
    expectedCloseOn: input.expectedCloseOn,
    openTaskCount: input.openTaskCount,
    overdueTaskCount: input.overdueTaskCount,
    pendingApprovalCount: input.pendingApprovalCount,
    quotePresented: input.quotePresented,
    blockerPresent: input.blockerPresent,
    now,
  });

  return {
    dealId: input.dealId,
    dealName: input.dealName,
    companyName: input.companyName,
    seats,
    expectedArchetypes,
    scores,
    snapshotAt: now.toISOString(),
  };
}
