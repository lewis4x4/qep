/**
 * Proposal Call Flips tests — Slice 20w.
 *
 * Classifier branches + bucket sort + headline copy strings all pinned.
 * The sanity-check case (one regressing flip, zero corroborating) is
 * specifically tested because that's the "don't silently approve a
 * proposal that hurts some deals" moment this module exists to surface.
 */

import { describe, expect, test } from "bun:test";
import {
  classifyFlip,
  computeProposalCallFlips,
  describeCallFlipsHeadline,
  formatFlipRow,
  CALL_THRESHOLD,
  MAX_FLIPS_PER_BUCKET,
} from "../proposal-call-flips";
import type {
  ScorerWhatIfResult,
  SimulatedDeal,
} from "../scorer-what-if";

function whatIf(
  perDeal: SimulatedDeal[],
  overrides: Partial<ScorerWhatIfResult> = {},
): ScorerWhatIfResult {
  return {
    dealsSimulated: perDeal.length,
    currentBrier: perDeal.length > 0 ? 0.25 : null,
    simulatedBrier: perDeal.length > 0 ? 0.22 : null,
    brierDelta: perDeal.length > 0 ? -0.03 : null,
    currentHitRate: perDeal.length > 0 ? 0.6 : null,
    simulatedHitRate: perDeal.length > 0 ? 0.68 : null,
    hitRateDelta: perDeal.length > 0 ? 0.08 : null,
    perDeal,
    lowConfidence: false,
    noActionableChanges: false,
    ...overrides,
  };
}

function deal(
  overrides: Partial<SimulatedDeal> &
    Pick<SimulatedDeal, "packageId" | "outcome" | "predicted" | "simulated">,
): SimulatedDeal {
  return {
    delta: overrides.simulated - overrides.predicted,
    ...overrides,
  };
}

// ── Constants ─────────────────────────────────────────────────────────

describe("Call-flip constants", () => {
  test("CALL_THRESHOLD matches the healthy-band boundary", () => {
    expect(CALL_THRESHOLD).toBe(55);
  });
  test("MAX_FLIPS_PER_BUCKET stays inside the attention budget", () => {
    expect(MAX_FLIPS_PER_BUCKET).toBe(3);
  });
});

// ── classifyFlip — the five kinds ─────────────────────────────────────

describe("classifyFlip", () => {
  test("miss → win flip that matches a won outcome → corroborating", () => {
    const f = classifyFlip(
      deal({ packageId: "p1", outcome: "won", predicted: 42, simulated: 61 }),
    );
    expect(f.kind).toBe("corroborating");
    expect(f.previousCall).toBe("miss");
    expect(f.proposedCall).toBe("win");
    expect(f.delta).toBe(19);
  });

  test("win → miss flip that matches a lost outcome → corroborating", () => {
    const f = classifyFlip(
      deal({ packageId: "p2", outcome: "lost", predicted: 62, simulated: 40 }),
    );
    expect(f.kind).toBe("corroborating");
    expect(f.previousCall).toBe("win");
    expect(f.proposedCall).toBe("miss");
  });

  test("miss → win flip on a LOST deal → regressing (wrong direction)", () => {
    const f = classifyFlip(
      deal({ packageId: "p3", outcome: "lost", predicted: 40, simulated: 62 }),
    );
    expect(f.kind).toBe("regressing");
  });

  test("win → miss flip on a WON deal → regressing", () => {
    const f = classifyFlip(
      deal({ packageId: "p4", outcome: "won", predicted: 62, simulated: 40 }),
    );
    expect(f.kind).toBe("regressing");
  });

  test("same-call, both correct (win/win/won) → aligned_unchanged", () => {
    const f = classifyFlip(
      deal({ packageId: "p5", outcome: "won", predicted: 70, simulated: 68 }),
    );
    expect(f.kind).toBe("aligned_unchanged");
  });

  test("same-call, both wrong (miss/miss/won) → misaligned_unchanged", () => {
    const f = classifyFlip(
      deal({ packageId: "p6", outcome: "won", predicted: 30, simulated: 45 }),
    );
    expect(f.kind).toBe("misaligned_unchanged");
  });

  test("expired deal → kind='expired' regardless of score movement", () => {
    const f = classifyFlip(
      deal({ packageId: "p7", outcome: "expired", predicted: 40, simulated: 70 }),
    );
    expect(f.kind).toBe("expired");
  });

  test("exact threshold boundary — score == 55 counts as win (inclusive)", () => {
    const f = classifyFlip(
      deal({ packageId: "p8", outcome: "won", predicted: 54, simulated: 55 }),
    );
    expect(f.previousCall).toBe("miss");
    expect(f.proposedCall).toBe("win");
    expect(f.kind).toBe("corroborating");
  });
});

// ── computeProposalCallFlips — empty + no-actionable-changes guards ──

describe("computeProposalCallFlips — guard cases", () => {
  test("empty perDeal → report.empty=true, all counts zero", () => {
    const r = computeProposalCallFlips(whatIf([]));
    expect(r.empty).toBe(true);
    expect(r.corroborating).toEqual([]);
    expect(r.regressing).toEqual([]);
    expect(r.totalFlips).toBe(0);
    expect(r.resolvedCount).toBe(0);
  });

  test("noActionableChanges → report.noActionableChanges=true, buckets empty", () => {
    const r = computeProposalCallFlips(
      whatIf(
        [deal({ packageId: "p1", outcome: "won", predicted: 70, simulated: 70 })],
        { noActionableChanges: true },
      ),
    );
    expect(r.noActionableChanges).toBe(true);
    expect(r.corroborating).toEqual([]);
    expect(r.regressing).toEqual([]);
  });
});

// ── computeProposalCallFlips — full classification ───────────────────

describe("computeProposalCallFlips — full classification", () => {
  test("mixed bag: classifies, counts, and ranks each bucket by |delta|", () => {
    const deals: SimulatedDeal[] = [
      // Corroborating: won, flipped miss→win
      deal({ packageId: "a", outcome: "won", predicted: 42, simulated: 58 }),  // delta +16
      deal({ packageId: "b", outcome: "won", predicted: 40, simulated: 70 }),  // delta +30, BIG
      // Regressing: won, flipped win→miss
      deal({ packageId: "c", outcome: "won", predicted: 60, simulated: 40 }),  // delta -20
      // aligned_unchanged
      deal({ packageId: "d", outcome: "won", predicted: 70, simulated: 72 }),
      // misaligned_unchanged
      deal({ packageId: "e", outcome: "lost", predicted: 80, simulated: 78 }),
      // expired
      deal({ packageId: "f", outcome: "expired", predicted: 40, simulated: 70 }),
    ];
    const r = computeProposalCallFlips(whatIf(deals));
    expect(r.corroborating).toHaveLength(2);
    // Biggest-magnitude first
    expect(r.corroborating[0].packageId).toBe("b");
    expect(r.corroborating[1].packageId).toBe("a");
    expect(r.regressing).toHaveLength(1);
    expect(r.regressing[0].packageId).toBe("c");
    expect(r.alignedUnchangedCount).toBe(1);
    expect(r.misalignedUnchangedCount).toBe(1);
    expect(r.expiredCount).toBe(1);
    expect(r.resolvedCount).toBe(5); // expired excluded
    expect(r.totalFlips).toBe(3);
    expect(r.netImprovement).toBe(1); // 2 corroborating - 1 regressing
  });

  test("more than MAX_FLIPS_PER_BUCKET corroborating → sliced to cap; netImprovement uses full count", () => {
    const deals: SimulatedDeal[] = [];
    for (let i = 0; i < 5; i++) {
      deals.push(
        deal({
          packageId: `c${i}`,
          outcome: "won",
          predicted: 40 - i, // widening delta so sort differentiates
          simulated: 60 + i,
        }),
      );
    }
    const r = computeProposalCallFlips(whatIf(deals));
    expect(r.corroborating.length).toBe(MAX_FLIPS_PER_BUCKET);
    // netImprovement reflects ALL 5 corroborating, not just displayed 3.
    expect(r.netImprovement).toBe(5);
    expect(r.totalFlips).toBe(5);
  });

  test("lowConfidence propagates from whatIf", () => {
    const r = computeProposalCallFlips(
      whatIf(
        [deal({ packageId: "a", outcome: "won", predicted: 40, simulated: 70 })],
        { lowConfidence: true },
      ),
    );
    expect(r.lowConfidence).toBe(true);
  });
});

// ── describeCallFlipsHeadline ────────────────────────────────────────

describe("describeCallFlipsHeadline", () => {
  test("empty → null (don't render the section)", () => {
    const r = computeProposalCallFlips(whatIf([]));
    expect(describeCallFlipsHeadline(r)).toBeNull();
  });

  test("noActionableChanges → null", () => {
    const r = computeProposalCallFlips(
      whatIf([deal({ packageId: "a", outcome: "won", predicted: 70, simulated: 70 })], { noActionableChanges: true }),
    );
    expect(describeCallFlipsHeadline(r)).toBeNull();
  });

  test("zero flips, some resolved deals → 'refines scores without changing any verdicts'", () => {
    const r = computeProposalCallFlips(
      whatIf([
        deal({ packageId: "a", outcome: "won", predicted: 70, simulated: 72 }),
        deal({ packageId: "b", outcome: "won", predicted: 80, simulated: 82 }),
      ]),
    );
    expect(describeCallFlipsHeadline(r)).toBe(
      "No call flips on 2 resolved deals — the proposal refines scores without changing any verdicts.",
    );
  });

  test("corroborating only → 'right direction, none in the wrong direction'", () => {
    const r = computeProposalCallFlips(
      whatIf([deal({ packageId: "a", outcome: "won", predicted: 40, simulated: 70 })]),
    );
    expect(describeCallFlipsHeadline(r)).toBe(
      "1 call would flip in the right direction, none in the wrong direction.",
    );
  });

  test("regressing only → warning copy", () => {
    const r = computeProposalCallFlips(
      whatIf([deal({ packageId: "a", outcome: "won", predicted: 60, simulated: 40 })]),
    );
    expect(describeCallFlipsHeadline(r)).toBe(
      "⚠ 1 call would regress, none would corroborate — review carefully before applying.",
    );
  });

  test("mixed → net-signed headline", () => {
    const deals: SimulatedDeal[] = [
      deal({ packageId: "a", outcome: "won", predicted: 40, simulated: 70 }),
      deal({ packageId: "b", outcome: "won", predicted: 42, simulated: 60 }),
      deal({ packageId: "c", outcome: "won", predicted: 62, simulated: 40 }),
    ];
    const r = computeProposalCallFlips(whatIf(deals));
    expect(describeCallFlipsHeadline(r)).toBe(
      "2 corroborating, 1 regressing (net +1 toward correctness).",
    );
  });

  test("lowConfidence adds '(directional only — thin sample)' suffix", () => {
    const r = computeProposalCallFlips(
      whatIf(
        [deal({ packageId: "a", outcome: "won", predicted: 40, simulated: 70 })],
        { lowConfidence: true },
      ),
    );
    const h = describeCallFlipsHeadline(r)!;
    expect(h).toContain("directional only");
    expect(h).toContain("thin sample");
  });
});

// ── formatFlipRow ────────────────────────────────────────────────────

describe("formatFlipRow", () => {
  test("composes prev → proposed with verdict labels and outcome", () => {
    const flip = classifyFlip(
      deal({ packageId: "a", outcome: "won", predicted: 42, simulated: 61 }),
    );
    expect(formatFlipRow(flip)).toBe("42% (miss) → 61% (win) · won");
  });

  test("lost outcome renders 'lost'", () => {
    const flip = classifyFlip(
      deal({ packageId: "b", outcome: "lost", predicted: 62, simulated: 40 }),
    );
    expect(formatFlipRow(flip)).toBe("62% (win) → 40% (miss) · lost");
  });

  test("expired outcome renders 'expired'", () => {
    const flip = classifyFlip(
      deal({ packageId: "c", outcome: "expired", predicted: 40, simulated: 70 }),
    );
    expect(formatFlipRow(flip)).toBe("40% (miss) → 70% (win) · expired");
  });
});
