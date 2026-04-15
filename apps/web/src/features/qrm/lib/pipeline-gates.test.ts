import { describe, expect, test } from "bun:test";
import { evaluateStageGate, evaluateStageGateForSelection } from "./pipeline-gates";
import type { QrmDealStage, QrmRepSafeDeal } from "./types";

function makeDeal(overrides: Partial<QrmRepSafeDeal> = {}): QrmRepSafeDeal {
  return {
    id: "deal-1",
    workspaceId: "ws",
    name: "Test deal",
    stageId: "stage-1",
    primaryContactId: null,
    companyId: null,
    assignedRepId: null,
    amount: 100000,
    expectedCloseOn: null,
    nextFollowUpAt: null,
    lastActivityAt: null,
    closedAt: null,
    hubspotDealId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    slaDeadlineAt: null,
    depositStatus: null,
    depositAmount: null,
    sortPosition: null,
    marginPct: null,
    ...overrides,
  };
}

function makeStage(sortOrder: number, overrides: Partial<QrmDealStage> = {}): QrmDealStage {
  return {
    id: `stage-${sortOrder}`,
    workspaceId: "ws",
    name: `Stage ${sortOrder}`,
    sortOrder,
    probability: 0.5,
    isClosedWon: false,
    isClosedLost: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("evaluateStageGate", () => {
  test("allows moves inside pre-sale (sort_order < 13)", () => {
    const result = evaluateStageGate(makeDeal(), makeStage(5));
    expect(result.severity).toBe("allow");
    expect(result.proceed).toBe(true);
  });

  test("warns on low margin at close stages (13-16)", () => {
    const result = evaluateStageGate(makeDeal({ marginPct: 5 }), makeStage(14));
    expect(result.severity).toBe("warn");
    expect(result.proceed).toBe(true);
    expect(result.message).toContain("Low margin");
  });

  test("does not warn when margin is healthy", () => {
    const result = evaluateStageGate(makeDeal({ marginPct: 20 }), makeStage(14));
    expect(result.severity).toBe("allow");
  });

  test("blocks post-sale entry without verified deposit", () => {
    const result = evaluateStageGate(makeDeal({ depositStatus: "pending" }), makeStage(17));
    expect(result.severity).toBe("block");
    expect(result.proceed).toBe(false);
    expect(result.message).toContain("Deposit must be verified");
  });

  test("allows post-sale entry with verified deposit", () => {
    const result = evaluateStageGate(makeDeal({ depositStatus: "verified" }), makeStage(18));
    expect(result.severity).toBe("allow");
  });

  test("returns allow when deal or stage is missing", () => {
    expect(evaluateStageGate(null, makeStage(20)).severity).toBe("allow");
    expect(evaluateStageGate(makeDeal(), null).severity).toBe("allow");
  });
});

describe("evaluateStageGateForSelection", () => {
  test("blocks the entire selection if any deal would be blocked", () => {
    const deals = [
      makeDeal({ id: "a", depositStatus: "verified" }),
      makeDeal({ id: "b", depositStatus: "pending" }),
    ];
    const result = evaluateStageGateForSelection(deals, makeStage(18));
    expect(result.severity).toBe("block");
  });

  test("warns when one deal warns and none block", () => {
    const deals = [
      makeDeal({ id: "a", marginPct: 20 }),
      makeDeal({ id: "b", marginPct: 5 }),
    ];
    const result = evaluateStageGateForSelection(deals, makeStage(14));
    expect(result.severity).toBe("warn");
  });

  test("allows when every deal passes", () => {
    const deals = [makeDeal({ id: "a" }), makeDeal({ id: "b" })];
    const result = evaluateStageGateForSelection(deals, makeStage(5));
    expect(result.severity).toBe("allow");
  });

  test("empty selection is allow", () => {
    expect(evaluateStageGateForSelection([], makeStage(18)).severity).toBe("allow");
  });
});
