/**
 * Proposal Streak Breaks tests — Slice 20af.
 *
 * Behaviour this test pins:
 *
 *   • Empty cases: null current, empty history, previous-only-keep
 *   • No break: same (label, action) in current as in history → no entry
 *   • Consistent break (streak 2-3): action changed OR factor removed
 *   • Consolidated break (streak ≥ 4): action changed OR factor removed
 *   • Streak counting stops at first non-match — 20ae-compatible
 *   • Floor: prior streak < 2 never emits (that's just a fresh call
 *     moving, not a break)
 *   • Sort: longest streak first, label alpha tie-break
 *   • Keep rows in history never extend an actionable streak
 *   • Keep in current = null currentAction (factor left the proposal)
 *   • Headline copy + pill tone (BROKEN rose / EVOLVING amber / muted)
 *   • Determinism
 */

import { describe, expect, test } from "bun:test";
import {
  BREAK_FLOOR,
  CONSOLIDATED_BREAK,
  computeProposalStreakBreaks,
  describeStreakBreaksPill,
} from "../proposal-streak-breaks";
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

describe("computeProposalStreakBreaks — empty cases", () => {
  test("null current → empty report", () => {
    const r = computeProposalStreakBreaks([], null);
    expect(r.empty).toBe(true);
    expect(r.entries).toEqual([]);
    expect(r.headline).toBeNull();
  });

  test("empty history → empty report (nothing to break)", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([], curr);
    expect(r.empty).toBe(true);
  });

  test("history with only keep rows → empty report", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const hist = [proposalFrom([change({ label: "A", action: "keep" })])];
    const r = computeProposalStreakBreaks(hist, curr);
    expect(r.empty).toBe(true);
  });

  test("thresholds match 20ae consistent/consolidated bands", () => {
    expect(BREAK_FLOOR).toBe(2);
    expect(CONSOLIDATED_BREAK).toBe(4);
  });
});

describe("computeProposalStreakBreaks — no break scenarios", () => {
  test("same (label, action) in current and prev → no break", () => {
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([prev], curr);
    expect(r.empty).toBe(true);
  });

  test("label appearing in prev with streak 1 and moving → no break (below floor)", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    // prev-only single session = streak 1, below BREAK_FLOOR = 2
    const r = computeProposalStreakBreaks([prev], curr);
    expect(r.empty).toBe(true);
  });
});

describe("computeProposalStreakBreaks — consistent breaks", () => {
  test("streak 2, action changed → consistent-break", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([prev, prev], curr);
    expect(r.empty).toBe(false);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toEqual({
      label: "A",
      priorStreak: 2,
      previousAction: "flip",
      currentAction: "strengthen",
      kind: "consistent-break",
    });
  });

  test("streak 3, factor removed from current → consistent-break w/ null action", () => {
    const curr = proposalFrom([change({ label: "Other", action: "flip" })]);
    const prev = proposalFrom([change({ label: "A", action: "drop" })]);
    const r = computeProposalStreakBreaks([prev, prev, prev], curr);
    const entry = r.entries.find((e) => e.label === "A");
    expect(entry).toBeDefined();
    expect(entry!.priorStreak).toBe(3);
    expect(entry!.currentAction).toBeNull();
    expect(entry!.kind).toBe("consistent-break");
  });

  test("factor demoted to keep → counts as null (broken)", () => {
    const curr = proposalFrom([change({ label: "A", action: "keep" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([prev, prev], curr);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].currentAction).toBeNull();
  });
});

describe("computeProposalStreakBreaks — consolidated breaks", () => {
  test("streak 4, action changed → consolidated-break", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([prev, prev, prev, prev], curr);
    expect(r.entries[0].kind).toBe("consolidated-break");
    expect(r.entries[0].priorStreak).toBe(4);
  });

  test("streak 5+ still consolidated-break", () => {
    const curr = proposalFrom([change({ label: "A", action: "weaken" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks(
      [prev, prev, prev, prev, prev],
      curr,
    );
    expect(r.entries[0].kind).toBe("consolidated-break");
    expect(r.entries[0].priorStreak).toBe(5);
  });
});

describe("computeProposalStreakBreaks — streak counting", () => {
  test("streak stops at first non-matching session", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const sameAsPrev = proposalFrom([change({ label: "A", action: "flip" })]);
    const different = proposalFrom([change({ label: "A", action: "drop" })]);
    // history: prev=flip, prev-1=flip, prev-2=drop → streak=2 (flip only)
    const r = computeProposalStreakBreaks(
      [sameAsPrev, sameAsPrev, different, sameAsPrev],
      curr,
    );
    expect(r.entries[0].priorStreak).toBe(2);
    expect(r.entries[0].kind).toBe("consistent-break");
  });

  test("keep rows in history break the streak", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const keep = proposalFrom([change({ label: "A", action: "keep" })]);
    const r = computeProposalStreakBreaks([prev, prev, keep, prev], curr);
    // prev=flip, prev-1=flip, prev-2=keep → streak stops at prev-2
    expect(r.entries[0].priorStreak).toBe(2);
  });
});

describe("computeProposalStreakBreaks — sort + aggregates", () => {
  test("sorted by priorStreak desc, label alpha tie-break", () => {
    // Three labels, all with different streaks
    const curr = proposalFrom([
      change({ label: "Short", action: "strengthen" }),
      change({ label: "Long", action: "weaken" }),
      change({ label: "Mid", action: "drop" }),
    ]);
    // prev carries original actions for all three
    const prev = proposalFrom([
      change({ label: "Short", action: "flip" }),
      change({ label: "Long", action: "flip" }),
      change({ label: "Mid", action: "flip" }),
    ]);
    // history: prev x5 for "Long", prev x3 for "Mid", prev x2 for "Short"
    // Build: [prev, prev, prev, prevMidLong, prevLong]
    const prevMidLong = proposalFrom([
      change({ label: "Long", action: "flip" }),
      change({ label: "Mid", action: "flip" }),
    ]);
    const prevLong = proposalFrom([change({ label: "Long", action: "flip" })]);
    const history = [prev, prev, prevMidLong, prevMidLong, prevLong];
    // Long streak: prev, prev, prevMidLong, prevMidLong, prevLong = 5
    // Mid streak: prev, prev, prevMidLong, prevMidLong (then breaks at prevLong) = 4
    // Short streak: prev, prev (then breaks at prevMidLong) = 2
    const r = computeProposalStreakBreaks(history, curr);
    expect(r.entries.map((e) => e.label)).toEqual(["Long", "Mid", "Short"]);
    expect(r.entries.map((e) => e.priorStreak)).toEqual([5, 4, 2]);
  });

  test("aggregate counts split by kind", () => {
    const curr = proposalFrom([
      change({ label: "Consolidated", action: "strengthen" }),
      change({ label: "Consistent", action: "strengthen" }),
    ]);
    const prev = proposalFrom([
      change({ label: "Consolidated", action: "flip" }),
      change({ label: "Consistent", action: "flip" }),
    ]);
    const consolidatedHist = proposalFrom([
      change({ label: "Consolidated", action: "flip" }),
    ]);
    // history: prev, prev, prev, consolidatedHist (only Consolidated holds)
    // Consolidated streak: 4 (consolidated-break)
    // Consistent streak: 3 (consistent-break) — breaks at consolidatedHist
    const r = computeProposalStreakBreaks(
      [prev, prev, prev, consolidatedHist],
      curr,
    );
    expect(r.consolidatedBreakCount).toBe(1);
    expect(r.consistentBreakCount).toBe(1);
  });
});

describe("computeProposalStreakBreaks — headline + pill", () => {
  test("headline mentions consolidated + consistent counts", () => {
    const curr = proposalFrom([
      change({ label: "Consolidated", action: "strengthen" }),
    ]);
    const prev = proposalFrom([
      change({ label: "Consolidated", action: "flip" }),
    ]);
    const r = computeProposalStreakBreaks([prev, prev, prev, prev], curr);
    expect(r.headline).toContain("1 consolidated call broken");
  });

  test("pill: consolidated break → rose BROKEN", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([prev, prev, prev, prev], curr);
    expect(describeStreakBreaksPill(r)).toEqual({
      label: "⚡ BROKEN",
      tone: "rose",
    });
  });

  test("pill: only consistent break → amber EVOLVING", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const r = computeProposalStreakBreaks([prev, prev], curr);
    expect(describeStreakBreaksPill(r)).toEqual({
      label: "↯ EVOLVING",
      tone: "amber",
    });
  });

  test("pill: empty → muted no breaks", () => {
    const r = computeProposalStreakBreaks([], null);
    expect(describeStreakBreaksPill(r)).toEqual({
      label: "— no breaks",
      tone: "muted",
    });
  });
});

describe("computeProposalStreakBreaks — determinism", () => {
  test("same input → identical output", () => {
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const hist = [prev, prev, prev];
    const r1 = computeProposalStreakBreaks(hist, curr);
    const r2 = computeProposalStreakBreaks(hist, curr);
    expect(r1).toEqual(r2);
  });
});
