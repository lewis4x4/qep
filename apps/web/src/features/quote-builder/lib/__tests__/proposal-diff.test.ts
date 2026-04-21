/**
 * Proposal Diff tests — Slice 20ad.
 *
 * Behaviour this test pins:
 *
 *   • Empty / null cases (no previous OR no current) → empty diff
 *   • Content-identical proposals → empty=true but unchangedCount set
 *   • Added factors (actionable in current, absent from previous)
 *   • Removed factors (actionable in previous, absent from current)
 *   • Changed actions (same label, different verb)
 *   • Unchanged count increments only when label + action both match
 *   • keep rows on either side are ignored (keep → actionable counts
 *     as added; actionable → keep counts as removed)
 *   • Sorting: added / removed / changed are all sorted alphabetically
 *     by label for deterministic output
 *   • Headline copy pinned for each category
 *   • Pill tone rule: 0 drift → emerald stable, 1-2 drift → amber
 *     evolving, 3+ drift → rose thrashing, null/no-prior → muted
 *   • Determinism: same input → same output
 */

import { describe, expect, test } from "bun:test";
import {
  computeProposalDiff,
  describeProposalDiffPill,
} from "../proposal-diff";
import type {
  ScorerFactorChange,
  ScorerProposal,
} from "../scorer-proposal";

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

describe("computeProposalDiff — empty cases", () => {
  test("null previous → empty diff", () => {
    const curr = proposalFrom([change({ action: "flip" })]);
    const d = computeProposalDiff(null, curr);
    expect(d.empty).toBe(true);
    expect(d.headline).toBeNull();
  });

  test("null current → empty diff", () => {
    const prev = proposalFrom([change({ action: "flip" })]);
    const d = computeProposalDiff(prev, null);
    expect(d.empty).toBe(true);
  });

  test("both null → empty diff", () => {
    const d = computeProposalDiff(null, null);
    expect(d.empty).toBe(true);
  });

  test("identical proposals → empty=true but unchangedCount set", () => {
    const build = () =>
      proposalFrom([
        change({ label: "A", action: "flip" }),
        change({ label: "B", action: "strengthen" }),
      ]);
    const d = computeProposalDiff(build(), build());
    expect(d.empty).toBe(true);
    expect(d.unchangedCount).toBe(2);
    expect(d.addedFactors).toEqual([]);
    expect(d.removedFactors).toEqual([]);
    expect(d.changedActions).toEqual([]);
    expect(d.headline).toContain("stable");
    expect(d.headline).toContain("2 unchanged");
  });

  test("identical all-keep proposals → empty with unchanged=0 and null headline", () => {
    const build = () => proposalFrom([change({ label: "A", action: "keep" })]);
    const d = computeProposalDiff(build(), build());
    expect(d.empty).toBe(true);
    expect(d.unchangedCount).toBe(0);
    expect(d.headline).toBeNull();
  });
});

describe("computeProposalDiff — added / removed / changed", () => {
  test("added: factor actionable in current, absent from previous", () => {
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const curr = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(d.addedFactors).toEqual(["B"]);
    expect(d.removedFactors).toEqual([]);
    expect(d.changedActions).toEqual([]);
    expect(d.unchangedCount).toBe(1);
    expect(d.empty).toBe(false);
  });

  test("removed: factor actionable in previous, absent from current", () => {
    const prev = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "drop" }),
    ]);
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const d = computeProposalDiff(prev, curr);
    expect(d.addedFactors).toEqual([]);
    expect(d.removedFactors).toEqual(["B"]);
    expect(d.unchangedCount).toBe(1);
  });

  test("changed: same label, different action verb", () => {
    const prev = proposalFrom([change({ label: "Edge", action: "flip" })]);
    const curr = proposalFrom([change({ label: "Edge", action: "strengthen" })]);
    const d = computeProposalDiff(prev, curr);
    expect(d.changedActions).toHaveLength(1);
    expect(d.changedActions[0]).toEqual({
      label: "Edge",
      previousAction: "flip",
      currentAction: "strengthen",
    });
    expect(d.unchangedCount).toBe(0);
  });

  test("keep → actionable counts as added", () => {
    const prev = proposalFrom([change({ label: "A", action: "keep" })]);
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const d = computeProposalDiff(prev, curr);
    expect(d.addedFactors).toEqual(["A"]);
    expect(d.changedActions).toEqual([]);
  });

  test("actionable → keep counts as removed", () => {
    const prev = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const curr = proposalFrom([change({ label: "A", action: "keep" })]);
    const d = computeProposalDiff(prev, curr);
    expect(d.removedFactors).toEqual(["A"]);
    expect(d.changedActions).toEqual([]);
  });

  test("mix of added + removed + changed + unchanged", () => {
    const prev = proposalFrom([
      change({ label: "Stable", action: "strengthen" }),
      change({ label: "Moved", action: "flip" }),
      change({ label: "Dropped", action: "drop" }),
    ]);
    const curr = proposalFrom([
      change({ label: "Stable", action: "strengthen" }),
      change({ label: "Moved", action: "weaken" }),
      change({ label: "New", action: "flip" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(d.addedFactors).toEqual(["New"]);
    expect(d.removedFactors).toEqual(["Dropped"]);
    expect(d.changedActions).toHaveLength(1);
    expect(d.changedActions[0].label).toBe("Moved");
    expect(d.unchangedCount).toBe(1); // Stable
    expect(d.empty).toBe(false);
  });
});

describe("computeProposalDiff — sorting", () => {
  test("added factors are sorted alphabetically", () => {
    const prev = proposalFrom([]);
    const curr = proposalFrom([
      change({ label: "Charlie", action: "flip" }),
      change({ label: "Alpha", action: "flip" }),
      change({ label: "Bravo", action: "flip" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(d.addedFactors).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  test("removed factors are sorted alphabetically", () => {
    const prev = proposalFrom([
      change({ label: "Zulu", action: "flip" }),
      change({ label: "Alpha", action: "flip" }),
      change({ label: "Mike", action: "flip" }),
    ]);
    const curr = proposalFrom([]);
    const d = computeProposalDiff(prev, curr);
    expect(d.removedFactors).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  test("changed actions are sorted alphabetically by label", () => {
    const prev = proposalFrom([
      change({ label: "Zed", action: "flip" }),
      change({ label: "Apple", action: "flip" }),
    ]);
    const curr = proposalFrom([
      change({ label: "Zed", action: "strengthen" }),
      change({ label: "Apple", action: "strengthen" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(d.changedActions.map((c) => c.label)).toEqual(["Apple", "Zed"]);
  });
});

describe("computeProposalDiff — headline copy", () => {
  test("added-only headline", () => {
    const prev = proposalFrom([]);
    const curr = proposalFrom([change({ label: "A", action: "flip" })]);
    const d = computeProposalDiff(prev, curr);
    expect(d.headline).toContain("1 new call");
    expect(d.headline).toContain("Since last session");
  });

  test("removed-only headline", () => {
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const curr = proposalFrom([]);
    const d = computeProposalDiff(prev, curr);
    expect(d.headline).toContain("1 dropped");
  });

  test("changed-only headline uses 'actions moved'", () => {
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const d = computeProposalDiff(prev, curr);
    expect(d.headline).toContain("1 action moved");
  });

  test("multi-category headline preserves category order (new / dropped / moved)", () => {
    const prev = proposalFrom([
      change({ label: "ToDrop", action: "flip" }),
      change({ label: "ToMove", action: "flip" }),
    ]);
    const curr = proposalFrom([
      change({ label: "ToMove", action: "strengthen" }),
      change({ label: "ToAdd", action: "drop" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(d.headline).toContain("1 new call");
    expect(d.headline).toContain("1 dropped");
    expect(d.headline).toContain("1 action moved");
  });

  test("includes unchanged-count tail when stable calls persist", () => {
    const prev = proposalFrom([
      change({ label: "Stable", action: "flip" }),
      change({ label: "Moved", action: "flip" }),
    ]);
    const curr = proposalFrom([
      change({ label: "Stable", action: "flip" }),
      change({ label: "Moved", action: "strengthen" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(d.headline).toContain("1 unchanged call");
  });
});

describe("describeProposalDiffPill", () => {
  test("empty diff with unchangedCount>0 → emerald STABLE", () => {
    const d = computeProposalDiff(
      proposalFrom([change({ action: "flip" })]),
      proposalFrom([change({ action: "flip" })]),
    );
    expect(describeProposalDiffPill(d)).toEqual({
      label: "◆ STABLE",
      tone: "emerald",
    });
  });

  test("empty diff with unchangedCount=0 → muted 'no prior'", () => {
    const d = computeProposalDiff(null, proposalFrom([change({ action: "flip" })]));
    expect(describeProposalDiffPill(d)).toEqual({
      label: "— no prior",
      tone: "muted",
    });
  });

  test("1-2 drift rows → amber EVOLVING", () => {
    const prev = proposalFrom([change({ label: "A", action: "flip" })]);
    const curr = proposalFrom([change({ label: "A", action: "strengthen" })]);
    const d = computeProposalDiff(prev, curr);
    expect(describeProposalDiffPill(d).tone).toBe("amber");
    expect(describeProposalDiffPill(d).label).toContain("EVOLVING");
  });

  test("3+ drift rows → rose THRASHING", () => {
    const prev = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "flip" }),
      change({ label: "C", action: "flip" }),
    ]);
    const curr = proposalFrom([
      change({ label: "A", action: "strengthen" }),
      change({ label: "B", action: "weaken" }),
      change({ label: "C", action: "drop" }),
    ]);
    const d = computeProposalDiff(prev, curr);
    expect(describeProposalDiffPill(d).tone).toBe("rose");
    expect(describeProposalDiffPill(d).label).toContain("THRASHING");
  });
});

describe("computeProposalDiff — determinism", () => {
  test("same input → identical output", () => {
    const prev = proposalFrom([
      change({ label: "A", action: "flip" }),
      change({ label: "B", action: "strengthen" }),
    ]);
    const curr = proposalFrom([
      change({ label: "A", action: "strengthen" }),
      change({ label: "C", action: "drop" }),
    ]);
    const d1 = computeProposalDiff(prev, curr);
    const d2 = computeProposalDiff(prev, curr);
    expect(d1).toEqual(d2);
  });
});
