/**
 * Proposal Watchlist tests — Slice 20z.
 *
 * Every branch of the priority tree is pinned (flip → high; drop →
 * medium; strengthen/weaken → low unless thin-presence or volatile-
 * drift promotes it). Headline copy pinned verbatim so a typo
 * regression surfaces immediately. The "no watchable items" case is
 * explicitly tested — a stable, well-sampled strengthen-only proposal
 * should produce no watchlist.
 */

import { describe, expect, test } from "bun:test";
import {
  computeProposalWatchlist,
  SUBSTANTIAL_PRESENCE,
  LARGE_LIFT,
  VOLATILE_DRIFT,
} from "../proposal-watchlist";
import type {
  ScorerFactorChange,
  ScorerProposal,
  ScorerAction,
} from "../scorer-proposal";
import type {
  FactorDrift,
  FactorDriftReport,
} from "../factor-drift";

// ── Fixture factories ─────────────────────────────────────────────────

function changeOf(
  overrides: Partial<ScorerFactorChange> &
    Pick<ScorerFactorChange, "label" | "action">,
): ScorerFactorChange {
  return {
    currentAvgWeight: 5,
    lift: 0.15,
    present: 30,
    absent: 40,
    rationale: "",
    ...overrides,
  };
}

function proposalOf(changes: ScorerFactorChange[]): ScorerProposal {
  return {
    headline: "Evolution proposal.",
    changes,
    shadowCorroboration: null,
    lowConfidence: false,
  };
}

function driftReportOf(
  drifts: Array<{ label: string; drift: number | null }>,
): FactorDriftReport {
  const full: FactorDrift[] = drifts.map((d) => ({
    label: d.label,
    recentLift: null,
    priorLift: null,
    drift: d.drift,
    direction: "stable",
    recentPresent: 10,
    priorPresent: 15,
    recentAvgWeight: 5,
    lowConfidence: false,
  }));
  return {
    referenceDate: "2026-04-01T00:00:00.000Z",
    windowDays: 90,
    recentN: 25,
    priorN: 40,
    drifts: full,
    lowConfidence: false,
  };
}

// ── Constants ─────────────────────────────────────────────────────────

describe("Watchlist constants", () => {
  test("SUBSTANTIAL_PRESENCE is 15 (matches the factor-attribution low-sample bar)", () => {
    expect(SUBSTANTIAL_PRESENCE).toBe(15);
  });
  test("LARGE_LIFT is 0.25", () => {
    expect(LARGE_LIFT).toBe(0.25);
  });
  test("VOLATILE_DRIFT is 0.20", () => {
    expect(VOLATILE_DRIFT).toBeCloseTo(0.2);
  });
});

// ── Guard cases ───────────────────────────────────────────────────────

describe("computeProposalWatchlist — guard cases", () => {
  test("null proposal → empty=true, no items, no headline", () => {
    const r = computeProposalWatchlist(null, null);
    expect(r.empty).toBe(true);
    expect(r.items).toEqual([]);
    expect(r.headline).toBeNull();
  });

  test("proposal with zero changes → empty=true", () => {
    const r = computeProposalWatchlist(proposalOf([]), null);
    expect(r.empty).toBe(true);
  });

  test("all-keep proposal → empty=true (no actionable changes to monitor)", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "a", action: "keep" }),
        changeOf({ label: "b", action: "keep" }),
      ]),
      null,
    );
    expect(r.empty).toBe(true);
  });
});

// ── flip → high priority ──────────────────────────────────────────────

describe("computeProposalWatchlist — flip actions", () => {
  test("a flip with healthy sample and stable drift still renders as high-priority", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "Trade in hand", action: "flip", present: 25 })]),
      driftReportOf([{ label: "Trade in hand", drift: 0.05 }]),
    );
    expect(r.empty).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].priority).toBe("high");
    expect(r.items[0].action).toBe("flip");
    expect(r.items[0].concern).toContain("sign reversal");
    expect(r.items[0].trigger).toContain("hit-rate-when-present");
    expect(r.items[0].trigger).toContain("20 closed deals");
  });

  test("flip with thin presence adds a thin-sample note to concern", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "Repeat buyer", action: "flip", present: 8 })]),
      null,
    );
    expect(r.items[0].concern).toContain("Presence sample is thin");
    expect(r.items[0].concern).toContain("8 observations");
    expect(r.items[0].trigger).toContain("15 closed deals");
  });

  test("flip with volatile drift (>= VOLATILE_DRIFT) adds drift warning to concern", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "Vertical: Construction", action: "flip", present: 30 })]),
      driftReportOf([{ label: "Vertical: Construction", drift: -0.25 }]),
    );
    expect(r.items[0].concern).toContain("Drift is volatile");
    expect(r.items[0].concern).toContain("-25pp");
  });
});

// ── drop → medium priority ────────────────────────────────────────────

describe("computeProposalWatchlist — drop actions", () => {
  test("a drop produces a medium-priority item with the 'no longer consider' language", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "Ancient factor", action: "drop", present: 30, lift: 0.02 })]),
      null,
    );
    expect(r.items[0].priority).toBe("medium");
    expect(r.items[0].concern).toContain("no longer consider");
    expect(r.items[0].trigger).toContain("|lift|");
  });

  test("drop with thin sample notes the noise verdict may not hold", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "Thin factor", action: "drop", present: 10 })]),
      null,
    );
    expect(r.items[0].concern).toContain("noise");
    expect(r.items[0].concern).toContain("10 observations");
  });

  test("drop with large drift notes re-emergence risk", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "Moving factor", action: "drop", present: 25 })]),
      driftReportOf([{ label: "Moving factor", drift: 0.3 }]),
    );
    expect(r.items[0].concern).toContain("+30pp");
    expect(r.items[0].concern).toContain("re-emerge");
  });
});

// ── strengthen/weaken — watch only if thin or volatile ────────────────

describe("computeProposalWatchlist — strengthen/weaken", () => {
  test("healthy strengthen (substantial sample, stable drift) → dropped from watchlist", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "Healthy factor", action: "strengthen", present: 40 }),
      ]),
      driftReportOf([{ label: "Healthy factor", drift: 0.05 }]),
    );
    // Nothing to watch — filtered out.
    expect(r.items).toHaveLength(0);
    expect(r.empty).toBe(false); // proposal HAD actionable changes, just nothing worth watching
    expect(r.headline).toBeNull();
  });

  test("thin-presence strengthen → medium priority with thin-sample note", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "Small factor", action: "strengthen", present: 8 }),
      ]),
      null,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].priority).toBe("medium");
    expect(r.items[0].concern).toContain("strengthens");
    expect(r.items[0].trigger).toContain("back off the strengthening");
  });

  test("volatile-drift weaken (healthy sample) → low priority with volatile note", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "Volatile factor", action: "weaken", present: 30 }),
      ]),
      driftReportOf([{ label: "Volatile factor", drift: -0.25 }]),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].priority).toBe("low");
    expect(r.items[0].concern).toContain("weakens");
    expect(r.items[0].concern).toContain("volatile");
    expect(r.items[0].trigger).toContain("over-corrected");
  });

  test("strengthen with BOTH thin sample AND volatile drift → still medium (thin wins)", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "Double-risk factor", action: "strengthen", present: 5 }),
      ]),
      driftReportOf([{ label: "Double-risk factor", drift: 0.3 }]),
    );
    expect(r.items[0].priority).toBe("medium");
    expect(r.items[0].concern).toContain("thin");
    expect(r.items[0].concern).toContain("volatile");
  });
});

// ── Ranking + mixed ──────────────────────────────────────────────────

describe("computeProposalWatchlist — ranking", () => {
  test("mixed priorities rank high → medium → low, preserve insertion within", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        // Low — strengthen with volatile drift
        changeOf({ label: "low-a", action: "strengthen", present: 40 }),
        // High — flip
        changeOf({ label: "high", action: "flip", present: 25 }),
        // Medium — drop
        changeOf({ label: "medium", action: "drop", present: 25 }),
        // Low — weaken with volatile drift
        changeOf({ label: "low-b", action: "weaken", present: 30 }),
      ]),
      driftReportOf([
        { label: "low-a", drift: 0.25 },
        { label: "high", drift: 0.05 },
        { label: "medium", drift: 0.02 },
        { label: "low-b", drift: -0.3 },
      ]),
    );
    expect(r.items.map((it) => it.label)).toEqual([
      "high",
      "medium",
      "low-a",
      "low-b",
    ]);
  });

  test("watchlist with ONLY healthy strengthen/weaken → empty=false, no items, null headline", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "a", action: "strengthen", present: 40 }),
        changeOf({ label: "b", action: "weaken", present: 50 }),
      ]),
      driftReportOf([
        { label: "a", drift: 0.05 },
        { label: "b", drift: 0.03 },
      ]),
    );
    expect(r.items).toEqual([]);
    expect(r.empty).toBe(false);
    expect(r.headline).toBeNull();
  });
});

// ── Headline copy ────────────────────────────────────────────────────

describe("computeProposalWatchlist — headline", () => {
  test("single item → singular copy", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "one", action: "flip", present: 25 })]),
      null,
    );
    expect(r.headline).toBe("1 factor to monitor closely after applying.");
  });

  test("plural items with at least one high-priority → cites the high-priority count", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "a", action: "flip", present: 25 }),
        changeOf({ label: "b", action: "flip", present: 25 }),
        changeOf({ label: "c", action: "drop", present: 25 }),
      ]),
      null,
    );
    expect(r.headline).toBe(
      "3 factors to monitor after applying — 2 high-priority (sign reversals).",
    );
  });

  test("plural items without any high-priority → generic count headline", () => {
    const r = computeProposalWatchlist(
      proposalOf([
        changeOf({ label: "a", action: "drop", present: 25 }),
        changeOf({ label: "b", action: "drop", present: 25 }),
      ]),
      null,
    );
    expect(r.headline).toBe("2 factors to monitor after applying.");
  });
});

// ── Drift lookup edge cases ─────────────────────────────────────────

describe("computeProposalWatchlist — drift lookup edge cases", () => {
  test("null drift report → flips still watched, no drift copy", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "f1", action: "flip", present: 25 })]),
      null,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].concern).not.toContain("Drift is volatile");
  });

  test("factor missing from drift report → drift treated as null (not volatile)", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "f1", action: "flip", present: 25 })]),
      driftReportOf([{ label: "other-factor", drift: 0.5 }]),
    );
    expect(r.items[0].concern).not.toContain("volatile");
  });

  test("drift exactly at VOLATILE_DRIFT boundary counts as volatile", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "f1", action: "flip", present: 25 })]),
      driftReportOf([{ label: "f1", drift: -0.2 }]),
    );
    expect(r.items[0].concern).toContain("volatile");
  });

  test("drift with null delta → skipped in drift map, flip still high priority", () => {
    const r = computeProposalWatchlist(
      proposalOf([changeOf({ label: "f1", action: "flip", present: 25 })]),
      driftReportOf([{ label: "f1", drift: null }]),
    );
    expect(r.items[0].priority).toBe("high");
    expect(r.items[0].concern).not.toContain("volatile");
  });
});
