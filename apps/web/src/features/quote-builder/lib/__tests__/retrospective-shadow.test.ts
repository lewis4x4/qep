/**
 * Retrospective Shadow tests — Slice 20k.
 *
 * This slice is the empirical defense of whether managers should trust
 * the shadow. The rules that matter most to pin:
 *
 *   • Leave-one-out: the audited deal MUST NOT appear in its own peer
 *     history. A trivial self-match would falsely claim shadow wins.
 *   • Abstention: thin shadow data → `shadowAgreed = null`, and that
 *     row is excluded from agreement-rate denominators.
 *   • Disagreement math: when rule and shadow pick different sides,
 *     exactly one can be right; that one "won the disagreement".
 *   • Copy thresholds: headline phrasing changes at 60% and 40%.
 */

import { describe, expect, test } from "bun:test";
import {
  computeRetrospectiveShadows,
  computeShadowAgreementSummary,
  describeShadowTrustHeadline,
  MIN_DEALS_FOR_SHADOW_CONFIDENCE,
  WIN_PREDICTION_THRESHOLD,
  type RetrospectiveShadowRow,
} from "../retrospective-shadow";
import type { ClosedDealAuditRow } from "../closed-deals-audit";

const f = (label: string, weight: number) => ({ label, weight });

function row(overrides: Partial<ClosedDealAuditRow> = {}): ClosedDealAuditRow {
  return {
    packageId: "pkg-default",
    score: 60,
    outcome: "won",
    factors: [f("A", 5)],
    capturedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeRetrospectiveShadows — leave-one-out", () => {
  test("the audited row never appears as its own peer", () => {
    // Build a scenario where the audited row, if included as its own
    // peer, would trivially pull distance to 0. We verify by arranging
    // all OTHER rows to predict loss but the self-row is a won.
    // Correct LOO → shadow sees only losers → low shadow score →
    // shadowPredictsWin = false. If LOO were broken, self-match would
    // dominate and shadow would predict win.
    const unique = row({
      packageId: "self",
      outcome: "won",
      score: 80,
      factors: [f("UNIQUE_LABEL", 99)],
    });
    const losers: ClosedDealAuditRow[] = [];
    for (let i = 0; i < 12; i++) {
      losers.push(
        row({
          packageId: `loser-${i}`,
          outcome: "lost",
          score: 30,
          factors: [f("B", 1)],
        }),
      );
    }
    const retros = computeRetrospectiveShadows([unique, ...losers]);
    const self = retros.find((r) => r.packageId === "self")!;
    // All 12 peers lost → shadow ≈ 0 → shadow predicts not-win
    expect(self.shadowScore).toBe(0);
    expect(self.shadowAgreed).toBe(false); // shadow said "miss", actual was won
  });

  test("handles single-row input — self becomes empty-history", () => {
    const retros = computeRetrospectiveShadows([row()]);
    expect(retros).toHaveLength(1);
    expect(retros[0].shadowReason).toBe("empty-history");
    expect(retros[0].shadowLowConfidence).toBe(true);
    expect(retros[0].shadowAgreed).toBe(null);
  });

  test("filters malformed input rows", () => {
    const input = [
      row({ packageId: "ok" }),
      // @ts-expect-error bad outcome
      row({ packageId: "bad-outcome", outcome: "other" }),
      row({ packageId: "", score: 50 }), // empty packageId
      row({ packageId: "bad-score", score: Number.NaN }),
    ];
    const retros = computeRetrospectiveShadows(input);
    expect(retros.map((r) => r.packageId)).toEqual(["ok"]);
  });
});

describe("computeRetrospectiveShadows — prediction semantics", () => {
  test("rule predicts win when liveScore ≥ 50", () => {
    // 2 wons at score 60 + 2 losts at score 30
    const rows = [
      row({ packageId: "a", score: 60, outcome: "won", factors: [f("X", 1)] }),
      row({ packageId: "b", score: 60, outcome: "won", factors: [f("X", 1)] }),
      row({ packageId: "c", score: 30, outcome: "lost", factors: [f("Y", 1)] }),
      row({ packageId: "d", score: 30, outcome: "lost", factors: [f("Y", 1)] }),
    ];
    const retros = computeRetrospectiveShadows(rows);
    for (const r of retros) {
      if (r.liveScore >= WIN_PREDICTION_THRESHOLD) {
        expect(r.ruleAgreed).toBe(r.outcome === "won");
      } else {
        expect(r.ruleAgreed).toBe(r.outcome !== "won");
      }
    }
  });

  test("expired outcome counts as not-won", () => {
    const rows = [
      row({ packageId: "a", outcome: "expired", score: 80 }), // rule predicts win, reality = loss → disagree
    ];
    const retros = computeRetrospectiveShadows(rows);
    expect(retros[0].ruleAgreed).toBe(false);
  });

  test("boundary: score exactly 50 is treated as predicting win", () => {
    const rows = [row({ packageId: "a", score: 50, outcome: "won" })];
    const retros = computeRetrospectiveShadows(rows);
    expect(retros[0].liveScore).toBe(50);
    expect(retros[0].ruleAgreed).toBe(true);
  });
});

describe("computeShadowAgreementSummary", () => {
  function make(rows: Array<Partial<RetrospectiveShadowRow>>): RetrospectiveShadowRow[] {
    return rows.map((r, i) => ({
      packageId: r.packageId ?? `p-${i}`,
      outcome: r.outcome ?? "won",
      liveScore: r.liveScore ?? 60,
      shadowScore: r.shadowScore ?? 60,
      shadowLowConfidence: r.shadowLowConfidence ?? false,
      shadowReason: r.shadowReason ?? "ok",
      ruleAgreed: r.ruleAgreed ?? true,
      // Use `in` check so null passes through (?? would coerce null → true)
      shadowAgreed: "shadowAgreed" in r ? (r.shadowAgreed as boolean | null) : true,
      capturedAt: r.capturedAt ?? null,
    }));
  }

  test("empty list → lowConfidence, null rates", () => {
    const s = computeShadowAgreementSummary([]);
    expect(s.totalDeals).toBe(0);
    expect(s.scorableDeals).toBe(0);
    expect(s.ruleAgreementRate).toBe(null);
    expect(s.shadowAgreementRate).toBe(null);
    expect(s.shadowDisagreementWinRate).toBe(null);
    expect(s.lowConfidence).toBe(true);
  });

  test("abstention excluded from rate denominators", () => {
    const rows = make([
      { shadowAgreed: true, ruleAgreed: true },
      { shadowAgreed: null, ruleAgreed: true }, // abstain
      { shadowAgreed: null, ruleAgreed: false }, // abstain
    ]);
    const s = computeShadowAgreementSummary(rows);
    expect(s.totalDeals).toBe(3);
    expect(s.shadowAbstainCount).toBe(2);
    expect(s.scorableDeals).toBe(1);
    expect(s.ruleAgreedCount).toBe(1);
    expect(s.shadowAgreedCount).toBe(1);
    expect(s.ruleAgreementRate).toBe(1);
    expect(s.shadowAgreementRate).toBe(1);
  });

  test("disagreement math: shadow won when ruleAgreed=false, shadowAgreed=true", () => {
    const rows = make([
      // agree-agree (both right)
      { shadowAgreed: true, ruleAgreed: true },
      // agree-agree (both wrong — same-side miss)
      { shadowAgreed: false, ruleAgreed: false },
      // disagreement, shadow right
      { shadowAgreed: true, ruleAgreed: false },
      { shadowAgreed: true, ruleAgreed: false },
      { shadowAgreed: true, ruleAgreed: false },
      // disagreement, rule right
      { shadowAgreed: false, ruleAgreed: true },
      { shadowAgreed: false, ruleAgreed: true },
    ]);
    const s = computeShadowAgreementSummary(rows);
    expect(s.disagreementCount).toBe(5);
    expect(s.shadowWonDisagreementCount).toBe(3);
    expect(s.shadowDisagreementWinRate).toBeCloseTo(3 / 5, 6);
  });

  test("lowConfidence fires under MIN_DEALS_FOR_SHADOW_CONFIDENCE scorable", () => {
    const rows = make(
      new Array(MIN_DEALS_FOR_SHADOW_CONFIDENCE - 1).fill({
        shadowAgreed: true,
        ruleAgreed: true,
      }),
    );
    const s = computeShadowAgreementSummary(rows);
    expect(s.lowConfidence).toBe(true);
  });

  test("lowConfidence clears at threshold", () => {
    const rows = make(
      new Array(MIN_DEALS_FOR_SHADOW_CONFIDENCE).fill({
        shadowAgreed: true,
        ruleAgreed: true,
      }),
    );
    const s = computeShadowAgreementSummary(rows);
    expect(s.lowConfidence).toBe(false);
  });

  test("no-disagreement case returns null rate, not NaN or 0", () => {
    const rows = make([
      { shadowAgreed: true, ruleAgreed: true },
      { shadowAgreed: true, ruleAgreed: true },
    ]);
    const s = computeShadowAgreementSummary(rows);
    expect(s.disagreementCount).toBe(0);
    expect(s.shadowDisagreementWinRate).toBe(null);
  });
});

describe("describeShadowTrustHeadline", () => {
  function sum(overrides: Partial<ReturnType<typeof computeShadowAgreementSummary>> = {}) {
    return {
      totalDeals: 20,
      shadowAbstainCount: 0,
      scorableDeals: 20,
      ruleAgreedCount: 12,
      shadowAgreedCount: 12,
      ruleAgreementRate: 0.6,
      shadowAgreementRate: 0.6,
      disagreementCount: 10,
      shadowWonDisagreementCount: 5,
      shadowDisagreementWinRate: 0.5,
      lowConfidence: false,
      ...overrides,
    };
  }

  test("no deals → 'not enough' copy", () => {
    const msg = describeShadowTrustHeadline(
      sum({ scorableDeals: 0, disagreementCount: 0, shadowDisagreementWinRate: null }),
    );
    expect(msg.toLowerCase()).toContain("not enough closed deals");
  });

  test("low confidence → 'directional' copy", () => {
    const msg = describeShadowTrustHeadline(
      sum({ scorableDeals: 3, lowConfidence: true }),
    );
    expect(msg.toLowerCase()).toContain("directional");
  });

  test("no disagreements → 'agreed on every call' copy", () => {
    const msg = describeShadowTrustHeadline(
      sum({ disagreementCount: 0, shadowDisagreementWinRate: null }),
    );
    expect(msg.toLowerCase()).toContain("every call");
  });

  test("shadow wins >= 60% → 'worth a second look'", () => {
    const msg = describeShadowTrustHeadline(
      sum({
        disagreementCount: 10,
        shadowWonDisagreementCount: 7,
        shadowDisagreementWinRate: 0.7,
      }),
    );
    expect(msg.toLowerCase()).toContain("worth a second look");
  });

  test("shadow wins <= 40% → 'rule scorer has been the stronger signal'", () => {
    const msg = describeShadowTrustHeadline(
      sum({
        disagreementCount: 10,
        shadowWonDisagreementCount: 3,
        shadowDisagreementWinRate: 0.3,
      }),
    );
    expect(msg.toLowerCase()).toContain("stronger signal");
  });

  test("41-59% → 'coin-flip' copy", () => {
    const msg = describeShadowTrustHeadline(
      sum({
        disagreementCount: 10,
        shadowWonDisagreementCount: 5,
        shadowDisagreementWinRate: 0.5,
      }),
    );
    expect(msg.toLowerCase()).toContain("coin-flip");
  });
});
