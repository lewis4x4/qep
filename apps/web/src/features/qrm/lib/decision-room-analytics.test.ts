import { describe, expect, it } from "bun:test";
import { aggregateMoves, clusterSignature, type MoveRow } from "./decision-room-analytics";

function row(overrides: Partial<MoveRow>): MoveRow {
  return {
    id: `m${Math.random().toString(36).slice(2, 8)}`,
    moveText: "default move",
    mood: null,
    velocityDelta: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    userId: "u1",
    userName: "Alex Rep",
    dealId: "d1",
    dealName: "Deal 1",
    dealStageIsWon: false,
    dealStageIsLost: false,
    cohort: { equipment: "unknown", size: "unsized", tenure: "unknown" },
    ...overrides,
  };
}

describe("clusterSignature", () => {
  it("normalizes near-duplicate moves to the same signature", () => {
    expect(clusterSignature("Offer a 90-day deferred payment")).toBe(
      clusterSignature("offer 90 day deferred payment"),
    );
  });

  it("strips stopwords and sorts tokens", () => {
    const sig = clusterSignature("Bring in the rental manager to this deal");
    const tokens = sig.split(" ");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("to");
    expect(tokens).not.toContain("in");
    // Sort-stable so the same words in any order collapse.
    expect(clusterSignature("Bring the rental manager in")).toBe(
      clusterSignature("Manager rental bring in"),
    );
  });

  it("returns empty string for pure stopwords", () => {
    expect(clusterSignature("a the of")).toBe("");
  });
});

describe("aggregateMoves", () => {
  it("builds a mood distribution across all rows", () => {
    const rows = [
      row({ id: "1", mood: "positive" }),
      row({ id: "2", mood: "negative" }),
      row({ id: "3", mood: "positive" }),
      row({ id: "4", mood: null }),
    ];
    const agg = aggregateMoves(rows, 30);
    expect(agg.totalMoves).toBe(4);
    expect(agg.overallMood.positive).toBe(2);
    expect(agg.overallMood.negative).toBe(1);
    expect(agg.overallMood.unknown).toBe(1);
    expect(agg.overallMood.total).toBe(4);
  });

  it("clusters near-duplicate moves into a single bucket", () => {
    const rows = [
      row({ id: "1", moveText: "Offer a 90-day deferred payment", mood: "positive" }),
      row({ id: "2", moveText: "offer 90 day deferred payment plan", mood: "mixed" }),
      row({ id: "3", moveText: "Loop in the rental manager", mood: "positive" }),
    ];
    const agg = aggregateMoves(rows, 30);
    expect(agg.topMoves[0].count).toBe(2);
    expect(agg.topMoves[0].exemplar.toLowerCase()).toContain("deferred");
    expect(agg.topMoves[0].exemplar.toLowerCase()).toContain("payment");
    expect(agg.topMoves[0].mood.positive).toBe(1);
    expect(agg.topMoves[0].mood.mixed).toBe(1);
  });

  it("ranks reps by move count, breaks ties by deals-touched", () => {
    const rows = [
      row({ id: "1", userId: "u1", userName: "Alex", dealId: "d1" }),
      row({ id: "2", userId: "u1", userName: "Alex", dealId: "d2" }),
      row({ id: "3", userId: "u1", userName: "Alex", dealId: "d2" }),
      row({ id: "4", userId: "u2", userName: "Ben", dealId: "d3" }),
      row({ id: "5", userId: "u2", userName: "Ben", dealId: "d3" }),
      row({ id: "6", userId: "u2", userName: "Ben", dealId: "d3" }),
    ];
    const agg = aggregateMoves(rows, 30);
    // Same moveCount (3) for each rep; Alex wins tiebreak on dealsTouched (2 vs 1).
    expect(agg.reps[0].userName).toBe("Alex");
    expect(agg.reps[0].dealsTouched).toBe(2);
    expect(agg.reps[1].userName).toBe("Ben");
    expect(agg.reps[1].dealsTouched).toBe(1);
  });

  it("splits winning playbook and losing patterns by deal-stage flags", () => {
    const rows = [
      row({ id: "1", moveText: "send maintenance packet", dealStageIsWon: true, mood: "positive" }),
      row({ id: "2", moveText: "Send Maintenance Packet", dealStageIsWon: true, mood: "positive" }),
      row({ id: "3", moveText: "drop price 10%", dealStageIsLost: true, mood: "negative" }),
    ];
    const agg = aggregateMoves(rows, 30);
    expect(agg.winningPlaybook.rows).toHaveLength(2);
    expect(agg.winningPlaybook.topClusters[0].count).toBe(2);
    expect(agg.losingPatterns.rows).toHaveLength(1);
    expect(agg.losingPatterns.topClusters[0].exemplar).toBe("drop price 10%");
  });

  it("computes median velocity delta per cluster", () => {
    const rows = [
      row({ id: "1", moveText: "offer deferred payment", velocityDelta: 5 }),
      row({ id: "2", moveText: "offer a deferred payment", velocityDelta: -3 }),
      row({ id: "3", moveText: "offer deferred payment now", velocityDelta: 7 }),
    ];
    const agg = aggregateMoves(rows, 30);
    const cluster = agg.topMoves.find((c) => c.count === 3);
    expect(cluster?.medianVelocityDelta).toBe(5);
  });

  it("counts unique reps and unique deals", () => {
    const rows = [
      row({ userId: "u1", dealId: "d1" }),
      row({ userId: "u1", dealId: "d2" }),
      row({ userId: "u2", dealId: "d2" }),
    ];
    const agg = aggregateMoves(rows, 30);
    expect(agg.uniqueReps).toBe(2);
    expect(agg.uniqueDeals).toBe(2);
  });
});
