import { describe, expect, it } from "bun:test";
import { buildLearningLayerBoard } from "./learning-layer";

describe("buildLearningLayerBoard", () => {
  it("turns wins, losses, workflows, and patterns into dealership memory sections", () => {
    const board = buildLearningLayerBoard({
      wins: [
        { id: "deal-1", name: "CAT 320", amount: 150000, closedAt: "2026-04-10T00:00:00.000Z" },
      ],
      losses: [
        { id: "deal-2", name: "Bobcat T66", lossReason: "Budget cut", competitor: "CAT", closedAt: "2026-04-09T00:00:00.000Z" },
        { id: "deal-3", name: "Bobcat T76", lossReason: "Budget cut", competitor: null, closedAt: "2026-04-08T00:00:00.000Z" },
      ],
      workflowRuns: [
        { workflowSlug: "rental-nearing-end", status: "completed", durationMs: 60000, startedAt: "2026-04-10T00:00:00.000Z" },
        { workflowSlug: "rental-nearing-end", status: "completed", durationMs: 120000, startedAt: "2026-04-11T00:00:00.000Z" },
        { workflowSlug: "competitor-signal-from-voice", status: "failed", durationMs: 30000, startedAt: "2026-04-11T00:00:00.000Z" },
      ],
      suggestions: [
        { id: "sig-1", shortLabel: "Customer asks for iron photos", occurrenceCount: 5, uniqueUsers: 3, status: "open", promotedFlowId: null, lastSeenAt: "2026-04-11T00:00:00.000Z" },
      ],
      interventions: [
        { id: "im-1", alertType: "ar_exposure", resolutionType: "resolved", resolutionNotes: "Pulled deposit verification same day.", recurrenceCount: 2, resolvedAt: "2026-04-11T00:00:00.000Z" },
      ],
    });

    expect(board.summary.wins).toBe(1);
    expect(board.summary.losses).toBe(2);
    expect(board.wins[0]?.confidence).toBe("high");
    expect(board.losses[0]?.title).toBe("Budget cut");
    expect(board.workflows[0]?.title).toContain("Rental-Nearing-End".replace(/-/g, " "));
    expect(board.patterns.length).toBeGreaterThanOrEqual(2);
  });
});
