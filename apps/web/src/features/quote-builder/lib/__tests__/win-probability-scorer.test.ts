import { describe, expect, test } from "bun:test";
import {
  computeWinProbability,
  computeWinProbabilityLifts,
  MAX_LIFTS,
  MIN_LIFT_DELTA,
  WIN_PROB_WEIGHTS,
  type WinProbabilityContext,
} from "../win-probability-scorer";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

// ── Fixtures ─────────────────────────────────────────────────────────────

function draft(partial: Partial<QuoteWorkspaceDraft> = {}): Partial<QuoteWorkspaceDraft> {
  return {
    entryMode: "manual",
    branchSlug: "",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    ...partial,
  };
}

function signals(
  over: Partial<NonNullable<QuoteWorkspaceDraft["customerSignals"]>> = {},
): NonNullable<QuoteWorkspaceDraft["customerSignals"]> {
  return {
    openDeals: 0,
    openDealValueCents: 0,
    lastContactDaysAgo: null,
    pastQuoteCount: 0,
    pastQuoteValueCents: 0,
    ...over,
  };
}

const noCtx: WinProbabilityContext = { marginPct: null };

// ── Base + clamping ──────────────────────────────────────────────────────

describe("computeWinProbability — base + clamping", () => {
  test("empty draft returns base score with zero factors", () => {
    const r = computeWinProbability(draft(), noCtx);
    // No warmth, no signals, no equipment, no trade, no recommendation,
    // no margin → rawScore == base.
    expect(r.rawScore).toBe(WIN_PROB_WEIGHTS.base);
    expect(r.score).toBe(WIN_PROB_WEIGHTS.base);
    expect(r.factors.length).toBe(0);
  });

  test("clamps at upper bound 95 for maximum signal draft", () => {
    const r = computeWinProbability(
      draft({
        customerWarmth: "warm",
        customerSignals: signals({
          openDeals: 5,
          pastQuoteCount: 12,
          lastContactDaysAgo: 2,
        }),
        tradeAllowance: 25_000,
        equipment: [{ kind: "equipment" as const, title: "CAT 299D3", quantity: 1, unitPrice: 150_000 }],
        recommendation: { machine: "CAT 299D3", attachments: [], reasoning: "Test fixture" },
      }),
      { marginPct: 22, marginBaselineMedianPct: 18 },
    );
    // Sum is well above 95; must clamp down.
    expect(r.rawScore).toBeGreaterThan(95);
    expect(r.score).toBe(95);
    expect(r.band).toBe("strong");
  });

  test("clamps at lower bound 5 for maximum-negative draft", () => {
    const r = computeWinProbability(
      draft({
        customerWarmth: "dormant",
        customerSignals: signals({
          openDeals: 0,
          pastQuoteCount: 0,
          lastContactDaysAgo: 400,
        }),
      }),
      { marginPct: 2, marginBaselineMedianPct: 20 },
    );
    // base 40 - 10 (dormant) - 5 (no past) - 5 (no pipeline) - 8 (cold)
    //        - 8 (thin margin) = 4 → clamped to 5.
    expect(r.rawScore).toBeLessThan(5);
    expect(r.score).toBe(5);
    expect(r.band).toBe("at_risk");
  });
});

// ── Warmth ───────────────────────────────────────────────────────────────

describe("computeWinProbability — warmth factor", () => {
  test("warm customer adds +25", () => {
    const r = computeWinProbability(draft({ customerWarmth: "warm" }), noCtx);
    expect(r.score).toBe(WIN_PROB_WEIGHTS.base + 25);
    expect(r.factors[0]?.weight).toBe(25);
    expect(r.factors[0]?.label).toBe("Warm customer");
  });

  test("cool customer adds +5", () => {
    const r = computeWinProbability(draft({ customerWarmth: "cool" }), noCtx);
    expect(r.score).toBe(WIN_PROB_WEIGHTS.base + 5);
  });

  test("dormant customer subtracts 10", () => {
    const r = computeWinProbability(draft({ customerWarmth: "dormant" }), noCtx);
    expect(r.score).toBe(WIN_PROB_WEIGHTS.base - 10);
  });

  test("new customer subtracts 3", () => {
    const r = computeWinProbability(draft({ customerWarmth: "new" }), noCtx);
    expect(r.score).toBe(WIN_PROB_WEIGHTS.base - 3);
  });
});

// ── Past quote depth ─────────────────────────────────────────────────────

describe("computeWinProbability — past quote depth", () => {
  test("0 past quotes → 'First quote' label, -5", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ pastQuoteCount: 0 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label === "First quote");
    expect(f?.weight).toBe(-5);
  });

  test("3 past quotes → 'some' bucket, +5", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ pastQuoteCount: 3 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label.startsWith("3 past"));
    expect(f?.weight).toBe(5);
    expect(f?.label).toBe("3 past quotes");
  });

  test("exactly 5 past quotes → 'deep' bucket, +12", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ pastQuoteCount: 5 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label === "5 past quotes");
    expect(f?.weight).toBe(12);
  });

  test("1 past quote uses singular label", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ pastQuoteCount: 1 }) }),
      noCtx,
    );
    expect(r.factors.some((x) => x.label === "1 past quote")).toBe(true);
  });
});

// ── Open deals velocity ──────────────────────────────────────────────────

describe("computeWinProbability — open deals", () => {
  test("0 open → 'No active pipeline', -5", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ openDeals: 0 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label === "No active pipeline");
    expect(f?.weight).toBe(-5);
  });

  test("2 open → 'some' bucket, +5", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ openDeals: 2 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label === "2 open deals");
    expect(f?.weight).toBe(5);
  });

  test("3 open → 'many' bucket, +10", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ openDeals: 3 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label === "3 open deals");
    expect(f?.weight).toBe(10);
  });
});

// ── Recency ──────────────────────────────────────────────────────────────

describe("computeWinProbability — recency", () => {
  test("0 days → 'In touch today', hot +12", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ lastContactDaysAgo: 0 }) }),
      noCtx,
    );
    const f = r.factors.find((x) => x.label === "In touch today");
    expect(f?.weight).toBe(12);
  });

  test("14 days → hot boundary, still +12", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ lastContactDaysAgo: 14 }) }),
      noCtx,
    );
    expect(r.factors.find((x) => x.weight === 12)).toBeDefined();
  });

  test("30 days → warm bucket, +5", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ lastContactDaysAgo: 30 }) }),
      noCtx,
    );
    expect(r.factors.find((x) => x.label === "Last touch 30d ago")?.weight).toBe(5);
  });

  test("60 days → stale, 0", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ lastContactDaysAgo: 60 }) }),
      noCtx,
    );
    expect(r.factors.find((x) => x.label === "Last touch 60d ago")?.weight).toBe(0);
  });

  test("120 days → cold, -8", () => {
    const r = computeWinProbability(
      draft({ customerSignals: signals({ lastContactDaysAgo: 120 }) }),
      noCtx,
    );
    expect(r.factors.find((x) => x.label === "Last touch 120d ago")?.weight).toBe(-8);
  });
});

// ── Trade commitment ─────────────────────────────────────────────────────

describe("computeWinProbability — trade commitment", () => {
  test("non-zero tradeAllowance adds +10", () => {
    const r = computeWinProbability(draft({ tradeAllowance: 1000 }), noCtx);
    expect(r.score).toBe(WIN_PROB_WEIGHTS.base + 10);
    expect(r.factors.find((x) => x.label === "Trade in hand")?.weight).toBe(10);
  });

  test("zero tradeAllowance contributes nothing", () => {
    const r = computeWinProbability(draft({ tradeAllowance: 0 }), noCtx);
    expect(r.factors.some((x) => x.label === "Trade in hand")).toBe(false);
  });
});

// ── Fit factors ──────────────────────────────────────────────────────────

describe("computeWinProbability — fit factors", () => {
  test("selected equipment adds +5", () => {
    const r = computeWinProbability(
      draft({ equipment: [{ kind: "equipment" as const, title: "CAT 299D3", quantity: 1, unitPrice: 150_000 }] }),
      noCtx,
    );
    expect(r.factors.find((x) => x.label === "Equipment specced")?.weight).toBe(5);
  });

  test("AI recommendation adds +3", () => {
    const r = computeWinProbability(
      draft({ recommendation: { machine: "X", attachments: [], reasoning: "t" } }),
      noCtx,
    );
    expect(r.factors.find((x) => x.label === "AI-matched fit")?.weight).toBe(3);
  });
});

// ── Margin discipline ────────────────────────────────────────────────────

describe("computeWinProbability — margin discipline", () => {
  test("margin above baseline adds +5", () => {
    const r = computeWinProbability(draft(), {
      marginPct: 20,
      marginBaselineMedianPct: 15,
    });
    expect(r.factors.find((x) => x.label === "Healthy margin")?.weight).toBe(5);
  });

  test("margin at baseline counts as healthy (not below)", () => {
    const r = computeWinProbability(draft(), {
      marginPct: 15,
      marginBaselineMedianPct: 15,
    });
    expect(r.factors.find((x) => x.label === "Healthy margin")?.weight).toBe(5);
  });

  test("margin below baseline subtracts 8", () => {
    const r = computeWinProbability(draft(), {
      marginPct: 8,
      marginBaselineMedianPct: 15,
    });
    expect(r.factors.find((x) => x.label === "Thin margin")?.weight).toBe(-8);
  });

  test("null baseline → margin factor omitted entirely", () => {
    const r = computeWinProbability(draft(), { marginPct: 20 });
    expect(r.factors.some((x) => x.label === "Healthy margin")).toBe(false);
    expect(r.factors.some((x) => x.label === "Thin margin")).toBe(false);
  });
});

// ── Band thresholds ──────────────────────────────────────────────────────

describe("computeWinProbability — band thresholds", () => {
  test("score >= 70 → strong", () => {
    // base 40 + warm 25 + deep past 12 = 77
    const r = computeWinProbability(
      draft({
        customerWarmth: "warm",
        customerSignals: signals({ pastQuoteCount: 6 }),
      }),
      noCtx,
    );
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.band).toBe("strong");
  });

  test("score in [55, 70) → healthy", () => {
    // base 40 + cool 5 + some past 5 + some open 5 = 55
    const r = computeWinProbability(
      draft({
        customerWarmth: "cool",
        customerSignals: signals({ pastQuoteCount: 2, openDeals: 1 }),
      }),
      noCtx,
    );
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.score).toBeLessThan(70);
    expect(r.band).toBe("healthy");
  });

  test("score in [35, 55) → mixed", () => {
    // base 40 + new -3 = 37
    const r = computeWinProbability(
      draft({ customerWarmth: "new" }),
      noCtx,
    );
    expect(r.band).toBe("mixed");
  });

  test("score < 35 → at_risk", () => {
    // base 40 - 10 - 5 - 5 - 8 = 12 → clamped to 12 (> 5)
    const r = computeWinProbability(
      draft({
        customerWarmth: "dormant",
        customerSignals: signals({
          pastQuoteCount: 0,
          openDeals: 0,
          lastContactDaysAgo: 200,
        }),
      }),
      noCtx,
    );
    expect(r.band).toBe("at_risk");
  });
});

// ── Factor sort order + headlines ────────────────────────────────────────

describe("computeWinProbability — factor ordering + headlines", () => {
  test("factors sorted by absolute weight descending", () => {
    const r = computeWinProbability(
      draft({
        customerWarmth: "warm",                    // +25
        customerSignals: signals({
          pastQuoteCount: 6,                        // +12
          openDeals: 1,                             // +5
          lastContactDaysAgo: 5,                    // +12
        }),
        tradeAllowance: 1000,                       // +10
        recommendation: { machine: "X", attachments: [], reasoning: "t" },// +3
      }),
      noCtx,
    );
    const weights = r.factors.map((f) => Math.abs(f.weight));
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i - 1]! >= weights[i]!).toBe(true);
    }
    // Warm +25 is the single largest, must be first.
    expect(r.factors[0]?.label).toBe("Warm customer");
  });

  test("strong-band headline mentions top positive factor", () => {
    const r = computeWinProbability(
      draft({
        customerWarmth: "warm",
        customerSignals: signals({ pastQuoteCount: 6, lastContactDaysAgo: 3 }),
      }),
      noCtx,
    );
    expect(r.band).toBe("strong");
    expect(r.headline.toLowerCase()).toContain("on pace");
    expect(r.headline.toLowerCase()).toContain("warm customer");
  });

  test("at_risk-band headline mentions top negative factor", () => {
    const r = computeWinProbability(
      draft({
        customerWarmth: "dormant",
        customerSignals: signals({
          pastQuoteCount: 0,
          openDeals: 0,
          lastContactDaysAgo: 200,
        }),
      }),
      noCtx,
    );
    expect(r.band).toBe("at_risk");
    expect(r.headline.toLowerCase()).toContain("at risk");
  });

  test("mixed-band headline uses biggest drag when available", () => {
    const r = computeWinProbability(
      draft({ customerWarmth: "new" }),
      noCtx,
    );
    expect(r.band).toBe("mixed");
    expect(r.headline.toLowerCase()).toContain("mixed");
  });

  test("healthy-band with both pos and neg mentions both", () => {
    // base 40 + warm 25 - thin margin 8 = 57 → healthy
    const r = computeWinProbability(
      draft({ customerWarmth: "warm" }),
      { marginPct: 5, marginBaselineMedianPct: 15 },
    );
    expect(r.band).toBe("healthy");
    const h = r.headline.toLowerCase();
    expect(h).toContain("healthy");
    // Should reference both a positive ("warm customer") and a negative
    // ("thin margin") factor.
    expect(h).toContain("warm customer");
    expect(h).toContain("thin margin");
  });
});

// ── Stability / determinism ─────────────────────────────────────────────

describe("computeWinProbability — determinism", () => {
  test("same input produces identical output across calls", () => {
    const d = draft({
      customerWarmth: "cool",
      customerSignals: signals({ pastQuoteCount: 2, openDeals: 1, lastContactDaysAgo: 20 }),
      tradeAllowance: 500,
    });
    const a = computeWinProbability(d, noCtx);
    const b = computeWinProbability(d, noCtx);
    expect(a.score).toBe(b.score);
    expect(a.band).toBe(b.band);
    expect(a.headline).toBe(b.headline);
    expect(a.factors.length).toBe(b.factors.length);
  });
});

// ── Counterfactual lifts (Slice 20d) ─────────────────────────────────────

describe("computeWinProbabilityLifts — core behavior", () => {
  test("empty draft suggests capture_trade, select_equipment, ai_recommendation", () => {
    const lifts = computeWinProbabilityLifts(draft(), noCtx);
    const ids = lifts.map((l) => l.id);
    expect(ids).toContain("capture_trade");
    expect(ids).toContain("select_equipment");
    // reconnect needs a recency signal; raise_margin needs baseline →
    // neither applies on an empty draft.
    expect(ids).not.toContain("reconnect_customer");
    expect(ids).not.toContain("raise_margin");
  });

  test("caps returned lifts at MAX_LIFTS", () => {
    const lifts = computeWinProbabilityLifts(
      draft({
        customerSignals: signals({ lastContactDaysAgo: 120 }),
      }),
      { marginPct: 5, marginBaselineMedianPct: 20 },
    );
    expect(lifts.length).toBeLessThanOrEqual(MAX_LIFTS);
  });

  test("sorts lifts by deltaPts descending", () => {
    const lifts = computeWinProbabilityLifts(draft(), noCtx);
    for (let i = 1; i < lifts.length; i++) {
      expect(lifts[i - 1]!.deltaPts >= lifts[i]!.deltaPts).toBe(true);
    }
  });

  test("every returned lift has deltaPts >= MIN_LIFT_DELTA", () => {
    const lifts = computeWinProbabilityLifts(draft(), noCtx);
    for (const l of lifts) {
      expect(l.deltaPts).toBeGreaterThanOrEqual(MIN_LIFT_DELTA);
    }
  });

  test("lift deltas never exceed unclamped scorer ceiling", () => {
    // Sanity: no lift should claim to lift more than 95 - 5 = 90 pts.
    const lifts = computeWinProbabilityLifts(draft(), noCtx);
    for (const l of lifts) {
      expect(l.deltaPts).toBeLessThan(90);
    }
  });
});

describe("computeWinProbabilityLifts — skip-when-satisfied", () => {
  test("skips capture_trade when tradeAllowance > 0", () => {
    const lifts = computeWinProbabilityLifts(
      draft({ tradeAllowance: 5000 }),
      noCtx,
    );
    expect(lifts.some((l) => l.id === "capture_trade")).toBe(false);
  });

  test("skips select_equipment when equipment already selected", () => {
    const lifts = computeWinProbabilityLifts(
      draft({
        equipment: [{ kind: "equipment" as const, title: "CAT", quantity: 1, unitPrice: 100 }],
      }),
      noCtx,
    );
    expect(lifts.some((l) => l.id === "select_equipment")).toBe(false);
  });

  test("skips ai_recommendation when recommendation present", () => {
    const lifts = computeWinProbabilityLifts(
      draft({ recommendation: { machine: "X", attachments: [], reasoning: "r" } }),
      noCtx,
    );
    expect(lifts.some((l) => l.id === "ai_recommendation")).toBe(false);
  });

  test("skips reconnect_customer when recency is fresh", () => {
    const lifts = computeWinProbabilityLifts(
      draft({ customerSignals: signals({ lastContactDaysAgo: 10 }) }),
      noCtx,
    );
    expect(lifts.some((l) => l.id === "reconnect_customer")).toBe(false);
  });

  test("skips reconnect_customer when no recency signal at all", () => {
    const lifts = computeWinProbabilityLifts(
      draft({ customerSignals: signals({ lastContactDaysAgo: null }) }),
      noCtx,
    );
    expect(lifts.some((l) => l.id === "reconnect_customer")).toBe(false);
  });

  test("suggests reconnect_customer when stale >45d", () => {
    const lifts = computeWinProbabilityLifts(
      draft({ customerSignals: signals({ lastContactDaysAgo: 120 }) }),
      noCtx,
    );
    expect(lifts.some((l) => l.id === "reconnect_customer")).toBe(true);
  });

  test("skips raise_margin when margin baseline absent", () => {
    const lifts = computeWinProbabilityLifts(draft(), { marginPct: 10 });
    expect(lifts.some((l) => l.id === "raise_margin")).toBe(false);
  });

  test("skips raise_margin when margin already at/above baseline", () => {
    const lifts = computeWinProbabilityLifts(draft(), {
      marginPct: 20,
      marginBaselineMedianPct: 15,
    });
    expect(lifts.some((l) => l.id === "raise_margin")).toBe(false);
  });

  test("suggests raise_margin when below baseline", () => {
    const lifts = computeWinProbabilityLifts(draft(), {
      marginPct: 5,
      marginBaselineMedianPct: 20,
    });
    expect(lifts.some((l) => l.id === "raise_margin")).toBe(true);
  });
});

describe("computeWinProbabilityLifts — deltas use real scorer", () => {
  test("capture_trade delta matches tradeCommitment weight", () => {
    const lifts = computeWinProbabilityLifts(draft(), noCtx);
    const trade = lifts.find((l) => l.id === "capture_trade");
    expect(trade).toBeDefined();
    // The scorer adds WIN_PROB_WEIGHTS.tradeCommitment (+10) for a
    // trade. Delta should match exactly since clamp doesn't engage.
    expect(trade?.deltaPts).toBe(WIN_PROB_WEIGHTS.tradeCommitment);
  });

  test("select_equipment delta matches equipmentSelected weight", () => {
    const lifts = computeWinProbabilityLifts(draft(), noCtx);
    const eq = lifts.find((l) => l.id === "select_equipment");
    expect(eq?.deltaPts).toBe(WIN_PROB_WEIGHTS.equipmentSelected);
  });

  test("all lifts carry non-empty label, rationale, actionHint", () => {
    const lifts = computeWinProbabilityLifts(
      draft({ customerSignals: signals({ lastContactDaysAgo: 120 }) }),
      { marginPct: 5, marginBaselineMedianPct: 20 },
    );
    for (const l of lifts) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.rationale.length).toBeGreaterThan(0);
      expect(l.actionHint.length).toBeGreaterThan(0);
    }
  });
});
