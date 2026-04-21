/**
 * Proposal Consolidation tests — Slice 20ae.
 *
 * Behaviour this test pins:
 *
 *   • Empty cases (no current OR all-keep proposal) → empty report
 *   • Zero-history mount → every call is new, windowSize=0,
 *     headline mentions "no prior sessions"
 *   • Single matching prior session → streak=2 (consistent)
 *   • 3 matching prior sessions → streak=4 (consolidated)
 *   • Streak breaks at first non-matching session (action changed,
 *     or factor absent from a historical proposal)
 *   • Label matches but action differs → streak=1 (band="new")
 *   • Keep rows in history are ignored just like the 20ad diff rules
 *   • Deterministic sort: consolidated first, then consistent, then
 *     new, with label alphabetical tie-break
 *   • Aggregate counts / averageStreak math
 *   • Headline copy variants: zero history, all-consolidated,
 *     mixed, all-new
 *   • Pill tone: emerald majority-consolidated, sky consistent,
 *     amber fresh, muted no-history
 */

import { describe, expect, test } from "bun:test";
import {
  CONSOLIDATED_STREAK,
  CONSISTENT_STREAK,
  computeProposalConsolidation,
  describeConsolidationPill,
} from "../proposal-consolidation";
import type { ScorerFactorChange, ScorerProposal } from "../scorer-proposal";

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

describe("computeProposalConsolidation — empty cases", () => {
  test("null current → empty report", () => {
    const r = computeProposalConsolidation([], null);
    expect(r.empty).toBe(true);
    expect(r.entries).toEqual([]);
    expect(r.headline).toBeNull();
  });

  test("all-keep current → empty report", () => {
    const r = computeProposalConsolidation(
      [],
      proposalFrom([change({ action: "keep" })]),
    );
    expect(r.empty).toBe(true);
    expect(r.entries).toEqual([]);
  });

  test("windowSize reports history length even when empty", () => {
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation(
      [prev],
      proposalFrom([change({ action: "keep" })]),
    );
    expect(r.empty).toBe(true);
    expect(r.windowSize).toBe(1);
  });
});

describe("computeProposalConsolidation — zero-history mount", () => {
  test("no prior sessions → every call is new, windowSize 0", () => {
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "strengthen" }),
    ]);
    const r = computeProposalConsolidation([], curr);
    expect(r.empty).toBe(false);
    expect(r.windowSize).toBe(0);
    expect(r.entries).toHaveLength(2);
    expect(r.entries.every((e) => e.streak === 1)).toBe(true);
    expect(r.entries.every((e) => e.band === "new")).toBe(true);
    expect(r.newCount).toBe(2);
    expect(r.consolidatedCount).toBe(0);
    expect(r.headline).toContain("No prior sessions");
  });
});

describe("computeProposalConsolidation — streak math", () => {
  test("single matching prior → streak=2 (consistent)", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([prev], curr);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].streak).toBe(2);
    expect(r.entries[0].band).toBe("consistent");
  });

  test("CONSISTENT_STREAK threshold = 2", () => {
    expect(CONSISTENT_STREAK).toBe(2);
  });

  test("CONSOLIDATED_STREAK threshold = 4", () => {
    expect(CONSOLIDATED_STREAK).toBe(4);
  });

  test("3 matching priors → streak=4 (consolidated)", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([prev, prev, prev], curr);
    expect(r.entries[0].streak).toBe(4);
    expect(r.entries[0].band).toBe("consolidated");
  });

  test("streak breaks at first non-matching session (action changed)", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const same = proposalFrom([change({ label: "A", action: "flip" })]);
    const differentAction = proposalFrom([
      change({ label: "A", action: "strengthen" }),
    ]);
    // History: [most recent] same, same, differentAction, same — the
    // streak should stop at differentAction because we only walk
    // back while the pair matches.
    const r = computeProposalConsolidation(
      [same, same, differentAction, same],
      curr,
    );
    expect(r.entries[0].streak).toBe(3); // current + 2 same
  });

  test("streak breaks when factor is absent from a historical proposal", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const same = proposalFrom([change({ label: "A", action: "flip" })]);
    const without = proposalFrom([change({ label: "B", action: "flip" })]);
    const r = computeProposalConsolidation([same, without, same], curr);
    expect(r.entries[0].streak).toBe(2); // current + 1 same
  });

  test("label matches but action differs every session → streak=1", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const weaken = proposalFrom([change({ label: "A", action: "weaken" })]);
    const r = computeProposalConsolidation([weaken, weaken], curr);
    expect(r.entries[0].streak).toBe(1);
    expect(r.entries[0].band).toBe("new");
  });

  test("keep rows in history never extend an actionable streak", () => {
    // A factor that was "keep" last session is, by 20ad's actionable-
    // only rules, absent from the actionable view. Its streak as a
    // non-keep call must therefore start at 1 this session.
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const asKeep = proposalFrom([change({ label: "A", action: "keep" })]);
    const r = computeProposalConsolidation([asKeep, asKeep], curr);
    expect(r.entries[0].streak).toBe(1);
    expect(r.entries[0].band).toBe("new");
  });
});

describe("computeProposalConsolidation — sort + aggregates", () => {
  test("sort order: consolidated → consistent → new, label alpha tie-break", () => {
    const curr = proposalFrom([
      change({ label: "NewAlpha", action: "flip" }),
      change({ label: "NewBeta", action: "flip" }),
      change({ label: "Consolidated", action: "flip" }),
      change({ label: "Consistent", action: "flip" }),
    ]);
    const full = proposalFrom([
      change({ label: "Consolidated", action: "flip" }),
      change({ label: "Consistent", action: "flip" }),
    ]);
    const onlyConsolidated = proposalFrom([
      change({ label: "Consolidated", action: "flip" }),
    ]);
    // History (most recent first): full, full, full, onlyConsolidated
    //   Consolidated appears in all 4 → streak = 5 (consolidated)
    //   Consistent appears in 3 → streak = 4, but only with history we feed
    //     here that's: full (match), full (match), full (match),
    //     onlyConsolidated (no match) → streak = 4 (consolidated)
    //   Let's trim to make expectations crisp.
    const history = [full, full, onlyConsolidated];
    //   Consolidated: current+full+full+onlyConsolidated = streak 4 (consolidated)
    //   Consistent:   current+full+full (then break on onlyConsolidated) = 3 (consistent)
    //   NewAlpha/NewBeta: streak 1 each (new)
    const r = computeProposalConsolidation(history, curr);
    const labels = r.entries.map((e) => e.label);
    expect(labels).toEqual([
      "Consolidated",
      "Consistent",
      "NewAlpha",
      "NewBeta",
    ]);
    expect(r.entries[0].band).toBe("consolidated");
    expect(r.entries[1].band).toBe("consistent");
    expect(r.entries[2].band).toBe("new");
    expect(r.entries[3].band).toBe("new");
    expect(r.consolidatedCount).toBe(1);
    expect(r.newCount).toBe(2);
  });

  test("averageStreak is arithmetic mean across actionable entries", () => {
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
    ]);
    const withA = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([withA], curr);
    // A: streak 2, B: streak 1 → average 1.5
    expect(r.averageStreak).toBeCloseTo(1.5, 5);
  });

  test("averageStreak is null on empty report", () => {
    const r = computeProposalConsolidation([], null);
    expect(r.averageStreak).toBeNull();
  });
});

describe("computeProposalConsolidation — headline copy", () => {
  test("zero history mentions 'No prior sessions'", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([], curr);
    expect(r.headline).toContain("No prior sessions");
  });

  test("all-consolidated headline reports consolidated count", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([prev, prev, prev], curr);
    expect(r.headline).toContain("1 consolidated call");
  });

  test("mixed headline includes all three categories", () => {
    const curr = proposalFrom([
      change({ label: "Old", action: "flip" }),
      change({ label: "Middle", action: "flip" }),
      change({ label: "Fresh", action: "flip" }),
    ]);
    const withOldAndMiddle = proposalFrom([
      change({ label: "Old", action: "flip" }),
      change({ label: "Middle", action: "flip" }),
    ]);
    const withOld = proposalFrom([change({ label: "Old", action: "flip" })]);
    // History: [withOldAndMiddle, withOld, withOld]
    //   Old:    streak 4 → consolidated
    //   Middle: streak 2 → consistent
    //   Fresh:  streak 1 → new
    const r = computeProposalConsolidation(
      [withOldAndMiddle, withOld, withOld],
      curr,
    );
    expect(r.headline).toContain("1 consolidated");
    expect(r.headline).toContain("1 consistent");
    expect(r.headline).toContain("1 new");
  });

  test("window size appears in the headline", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([prev, prev], curr);
    expect(r.headline).toContain("last 2 sessions");
  });
});

describe("describeConsolidationPill", () => {
  test("empty report → muted no history", () => {
    const r = computeProposalConsolidation([], null);
    expect(describeConsolidationPill(r)).toEqual({
      label: "— no history",
      tone: "muted",
    });
  });

  test("windowSize 0 → muted no history even with entries", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([], curr);
    expect(describeConsolidationPill(r).tone).toBe("muted");
  });

  test("majority consolidated → emerald CONSOLIDATED", () => {
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
      change({ label: "C", action: "flip" }),
    ]);
    const all = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
      change({ label: "C", action: "flip" }),
    ]);
    const r = computeProposalConsolidation([all, all, all], curr);
    // All 3 entries have streak 4 (consolidated). 3/3 > 50% → emerald.
    expect(describeConsolidationPill(r).tone).toBe("emerald");
    expect(describeConsolidationPill(r).label).toContain("CONSOLIDATED");
  });

  test("majority consistent-or-better but not consolidated → sky CONSISTENT", () => {
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
      change({ label: "C", action: "flip" }),
    ]);
    const all = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
    ]);
    const r = computeProposalConsolidation([all], curr);
    // A, B: streak 2 (consistent); C: streak 1 (new). 2/3 consistent-
    // or-better, 0 consolidated → sky.
    expect(describeConsolidationPill(r).tone).toBe("sky");
    expect(describeConsolidationPill(r).label).toContain("CONSISTENT");
  });

  test("majority new → amber FRESH", () => {
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
      change({ label: "C", action: "flip" }),
    ]);
    const onlyA = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalConsolidation([onlyA], curr);
    // A: streak 2 (consistent); B, C: streak 1 (new). 2/3 new → amber.
    expect(describeConsolidationPill(r).tone).toBe("amber");
    expect(describeConsolidationPill(r).label).toContain("FRESH");
  });
});

describe("computeProposalConsolidation — determinism", () => {
  test("same input → identical output", () => {
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "strengthen" }),
    ]);
    const prev = proposalFrom([
      change({ label: "A", action: "flip" }),
    ]);
    const history = [prev, prev];
    const r1 = computeProposalConsolidation(history, curr);
    const r2 = computeProposalConsolidation(history, curr);
    expect(r1).toEqual(r2);
  });
});
