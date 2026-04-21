/**
 * Proposal Rollback tests — Slice 20ab.
 *
 * Behaviour this test pins:
 *
 *   • Empty / null proposal → empty plan
 *   • All-keep proposal → empty plan (nothing actionable to unwind)
 *   • Flip → high priority + "revert sign flip" operation with the
 *            prior weight direction named
 *   • Drop → medium priority + "re-add the factor at its pre-drop weight"
 *   • Strengthen → low priority + "reduce the weight multiplier"
 *   • Weaken → low priority + "restore the weight multiplier"
 *   • Watchlist cross-link: when a watchlist item exists for a factor,
 *     rollback inherits that item's priority and sets hasWatchTrigger=true
 *   • Watchlist cross-link: when no watchlist item, priority falls back
 *     to the action-derived default and hasWatchTrigger=false
 *   • Priority ordering: high → medium → low with stable secondary order
 *   • Headline copy pinned (breakdown + watchlist cross-link note)
 *   • Impact + operation sentences are present and non-empty
 *   • Determinism: same input → same output
 */

import { describe, expect, test } from "bun:test";
import { computeProposalRollback } from "../proposal-rollback";
import type {
  ScorerFactorChange,
  ScorerProposal,
} from "../scorer-proposal";
import type {
  ProposalWatchlist,
  WatchItem,
} from "../proposal-watchlist";

function change(overrides: Partial<ScorerFactorChange>): ScorerFactorChange {
  return {
    label: "F",
    currentAvgWeight: 5,
    lift: 0.3,
    present: 20,
    absent: 20,
    action: "strengthen",
    rationale: "test",
    ...overrides,
  };
}

function proposalFrom(changes: ScorerFactorChange[]): ScorerProposal {
  return {
    headline: "",
    changes,
    shadowCorroboration: null,
    lowConfidence: false,
  };
}

function watch(overrides: Partial<WatchItem>): WatchItem {
  return {
    label: "F",
    action: "flip",
    concern: "c",
    trigger: "t",
    priority: "high",
    ...overrides,
  };
}

function watchlistFrom(items: WatchItem[]): ProposalWatchlist {
  return {
    items,
    headline: `${items.length} to monitor`,
    empty: items.length === 0,
  };
}

describe("computeProposalRollback — empty cases", () => {
  test("null proposal → empty plan", () => {
    const r = computeProposalRollback(null, null);
    expect(r.empty).toBe(true);
    expect(r.steps).toEqual([]);
    expect(r.headline).toBeNull();
  });

  test("empty proposal → empty plan", () => {
    const p = proposalFrom([]);
    const r = computeProposalRollback(p, null);
    expect(r.empty).toBe(true);
  });

  test("all-keep proposal → empty plan", () => {
    const p = proposalFrom([
      change({ action: "keep" }),
      change({ label: "G", action: "keep" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.empty).toBe(true);
  });
});

describe("computeProposalRollback — per-action operation copy", () => {
  test("flip step references sign reversal + prior direction", () => {
    const p = proposalFrom([
      change({ label: "Trade in hand", currentAvgWeight: 8, action: "flip" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].action).toBe("flip");
    expect(r.steps[0].operation).toContain("Revert sign flip");
    expect(r.steps[0].operation).toContain("+8.0");
    expect(r.steps[0].operation).toContain("positive");
    expect(r.steps[0].impact.length).toBeGreaterThan(0);
  });

  test("flip with negative current weight names the right direction", () => {
    const p = proposalFrom([
      change({ label: "Trade in hand", currentAvgWeight: -6, action: "flip" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].operation).toContain("-6.0");
    expect(r.steps[0].operation).toContain("negative");
  });

  test("drop step references re-adding at pre-drop weight", () => {
    const p = proposalFrom([
      change({ label: "Tiny signal", currentAvgWeight: 3, action: "drop" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].action).toBe("drop");
    expect(r.steps[0].operation).toContain("Re-add");
    expect(r.steps[0].operation).toContain("+3.0");
  });

  test("strengthen step references reducing the multiplier", () => {
    const p = proposalFrom([
      change({ label: "Boost", currentAvgWeight: 2, action: "strengthen" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].action).toBe("strengthen");
    expect(r.steps[0].operation).toContain("Reduce the weight multiplier");
  });

  test("weaken step references restoring the multiplier", () => {
    const p = proposalFrom([
      change({ label: "Damp", currentAvgWeight: 7, action: "weaken" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].action).toBe("weaken");
    expect(r.steps[0].operation).toContain("Restore the weight multiplier");
  });
});

describe("computeProposalRollback — default priority from action", () => {
  test("flip default priority is high", () => {
    const p = proposalFrom([change({ action: "flip" })]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].priority).toBe("high");
    expect(r.steps[0].hasWatchTrigger).toBe(false);
  });

  test("drop default priority is medium", () => {
    const p = proposalFrom([change({ action: "drop" })]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].priority).toBe("medium");
  });

  test("strengthen default priority is low", () => {
    const p = proposalFrom([change({ action: "strengthen" })]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].priority).toBe("low");
  });

  test("weaken default priority is low", () => {
    const p = proposalFrom([change({ action: "weaken" })]);
    const r = computeProposalRollback(p, null);
    expect(r.steps[0].priority).toBe("low");
  });
});

describe("computeProposalRollback — watchlist cross-link", () => {
  test("watchlist item for a factor → hasWatchTrigger=true + inherits priority", () => {
    // Weaken default is low, but if watchlist escalates to medium, inherit.
    const p = proposalFrom([
      change({ label: "Escalated", action: "weaken" }),
    ]);
    const w = watchlistFrom([
      watch({ label: "Escalated", action: "weaken", priority: "medium" }),
    ]);
    const r = computeProposalRollback(p, w);
    expect(r.steps[0].hasWatchTrigger).toBe(true);
    expect(r.steps[0].priority).toBe("medium");
  });

  test("no watchlist item → hasWatchTrigger=false + default priority applies", () => {
    const p = proposalFrom([change({ action: "strengthen" })]);
    const w = watchlistFrom([]);
    const r = computeProposalRollback(p, w);
    expect(r.steps[0].hasWatchTrigger).toBe(false);
    expect(r.steps[0].priority).toBe("low");
  });

  test("null watchlist behaves identically to empty watchlist", () => {
    const p = proposalFrom([change({ action: "flip" })]);
    const r1 = computeProposalRollback(p, null);
    const r2 = computeProposalRollback(p, watchlistFrom([]));
    expect(r1.steps[0].priority).toBe(r2.steps[0].priority);
    expect(r1.steps[0].hasWatchTrigger).toBe(r2.steps[0].hasWatchTrigger);
  });
});

describe("computeProposalRollback — priority ordering", () => {
  test("steps sorted high → medium → low with stable secondary order", () => {
    const p = proposalFrom([
      change({ label: "A", action: "strengthen" }), // low
      change({ label: "B", action: "drop" }), // medium
      change({ label: "C", action: "flip" }), // high
      change({ label: "D", action: "weaken" }), // low
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.steps.map((s) => s.label)).toEqual(["C", "B", "A", "D"]);
  });

  test("watchlist-escalated low action outranks default-medium drop", () => {
    const p = proposalFrom([
      change({ label: "Weaken-but-watched", action: "weaken" }),
      change({ label: "Drop-normal", action: "drop" }),
    ]);
    const w = watchlistFrom([
      watch({
        label: "Weaken-but-watched",
        action: "weaken",
        priority: "high",
      }),
    ]);
    const r = computeProposalRollback(p, w);
    expect(r.steps[0].label).toBe("Weaken-but-watched");
    expect(r.steps[0].priority).toBe("high");
  });
});

describe("computeProposalRollback — headline copy", () => {
  test("single flip → '1 rollback step — 1 sign flip'", () => {
    const p = proposalFrom([change({ action: "flip" })]);
    const r = computeProposalRollback(p, null);
    expect(r.headline).toContain("1 rollback step");
    expect(r.headline).toContain("1 sign flip");
  });

  test("multi-action → breakdown with counts", () => {
    const p = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
      change({ label: "C", action: "strengthen" }),
      change({ label: "D", action: "weaken" }),
    ]);
    const r = computeProposalRollback(p, null);
    expect(r.headline).toContain("4 rollback steps");
    expect(r.headline).toContain("1 sign flip");
    expect(r.headline).toContain("1 re-add");
    expect(r.headline).toContain("2 weight adjustments");
  });

  test("all cross-linked → 'All cross-linked to the watchlist.'", () => {
    const p = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
    ]);
    const w = watchlistFrom([
      watch({ label: "A", action: "flip", priority: "high" }),
      watch({ label: "B", action: "drop", priority: "medium" }),
    ]);
    const r = computeProposalRollback(p, w);
    expect(r.headline).toContain("All cross-linked to the watchlist");
  });

  test("partial cross-link → 'M of N cross-linked to the watchlist.'", () => {
    const p = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
    ]);
    const w = watchlistFrom([
      watch({ label: "A", action: "flip", priority: "high" }),
    ]);
    const r = computeProposalRollback(p, w);
    expect(r.headline).toContain("1 of 2 cross-linked to the watchlist");
  });

  test("no cross-link → headline ends with bare period (no watchlist note)", () => {
    const p = proposalFrom([change({ action: "flip" })]);
    const r = computeProposalRollback(p, null);
    expect(r.headline).not.toContain("cross-linked");
  });
});

describe("computeProposalRollback — determinism", () => {
  test("same input → identical output", () => {
    const p = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
    ]);
    const w = watchlistFrom([
      watch({ label: "A", action: "flip", priority: "high" }),
    ]);
    const r1 = computeProposalRollback(p, w);
    const r2 = computeProposalRollback(p, w);
    expect(r1).toEqual(r2);
  });
});

describe("computeProposalRollback — impact copy non-empty", () => {
  test("every step has a non-empty impact sentence", () => {
    const p = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
      change({ label: "C", action: "strengthen" }),
      change({ label: "D", action: "weaken" }),
    ]);
    const r = computeProposalRollback(p, null);
    for (const s of r.steps) {
      expect(s.impact.length).toBeGreaterThan(10);
      expect(s.operation.length).toBeGreaterThan(10);
    }
  });
});
