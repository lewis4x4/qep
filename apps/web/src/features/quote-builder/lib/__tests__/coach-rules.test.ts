import { describe, expect, test } from "bun:test";
import {
  evaluateCoachRules,
  MAX_VISIBLE_SUGGESTIONS,
  type DealCoachContext,
  type RuleResult,
} from "../coach-rules";

// Thin helper to build a DealCoachContext from a partial — test fixtures
// don't have to specify fields irrelevant to the rule under test.
function ctx(partial: Partial<DealCoachContext> = {}): DealCoachContext {
  return {
    draft: partial.draft ?? {
      entryMode: "manual",
      branchSlug: "",
      recommendation: null,
      voiceSummary: null,
      equipment: [],
      attachments: [],
      tradeAllowance: 0,
      tradeValuationId: null,
    },
    computed: partial.computed ?? {
      equipmentTotal: 0,
      attachmentTotal: 0,
      subtotal: 0,
      netTotal: 0,
      marginAmount: 0,
      marginPct: 0,
    },
    userId: partial.userId ?? "user-1",
    userRole: partial.userRole ?? "rep",
    quotePackageId: partial.quotePackageId ?? null,
    marginBaseline: partial.marginBaseline ?? {
      medianPct: null, sampleSize: 0, usingTeamFallback: false,
    },
    activePrograms: partial.activePrograms ?? [],
    similarDeals:   partial.similarDeals ?? null,
    reasonIntelligence: partial.reasonIntelligence ?? { stats: [], totalSamples: 0 },
  };
}

describe("margin_baseline rule", () => {
  test("silent when baseline sample size < 3", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 10 },
      marginBaseline: { medianPct: 20, sampleSize: 2, usingTeamFallback: false },
    });
    expect(evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline")).toBeUndefined();
  });

  test("silent when draft margin is zero", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 0 },
      marginBaseline: { medianPct: 18, sampleSize: 50, usingTeamFallback: false },
    });
    expect(evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline")).toBeUndefined();
  });

  test("silent when current margin above baseline", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 22 },
      marginBaseline: { medianPct: 18, sampleSize: 50, usingTeamFallback: false },
    });
    expect(evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline")).toBeUndefined();
  });

  test("info tier when delta is -0.5 to -2 pts", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 17 },
      marginBaseline: { medianPct: 18.2, sampleSize: 50, usingTeamFallback: false },
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline");
    expect(r?.severity).toBe("info");
  });

  test("warning tier at -2 pts exactly", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 16 },
      marginBaseline: { medianPct: 18, sampleSize: 50, usingTeamFallback: false },
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline");
    expect(r?.severity).toBe("warning");
  });

  test("critical tier at -4 pts or more", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 12 },
      marginBaseline: { medianPct: 18, sampleSize: 50, usingTeamFallback: false },
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline");
    expect(r?.severity).toBe("critical");
  });

  test("copy distinguishes personal vs team fallback", () => {
    const personal = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 14 },
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: false },
    });
    const team = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 14 },
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: true },
    });
    const rPersonal = evaluateCoachRules(personal).find((r) => r.ruleId === "margin_baseline");
    const rTeam     = evaluateCoachRules(team).find((r) => r.ruleId === "margin_baseline");
    expect(rPersonal?.title).toContain("your baseline");
    expect(rTeam?.title).toContain("team's baseline");
  });

  test("metrics snapshot includes all thresholds", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 12 },
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: false },
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "margin_baseline");
    expect(r?.metrics).toMatchObject({
      current_margin_pct: 12,
      baseline_median_pct: 18,
      delta_pts: -6,
      baseline_sample_size: 25,
    });
  });
});

describe("active_programs rule", () => {
  test("silent when no active programs", () => {
    const c = ctx({ activePrograms: [] });
    expect(evaluateCoachRules(c).find((r) => r.ruleId === "active_programs")).toBeUndefined();
  });

  test("silent when draft already has an AI recommendation (rep has engaged)", () => {
    const c = ctx({
      draft: {
        entryMode: "ai_chat",
        branchSlug: "",
        recommendation: {
          machine: "ASV RT-135",
          summary: "Top match for the described job",
          reasoning: "Matches the RT-135 class description",
        } as any,
        voiceSummary: null,
        equipment: [],
        attachments: [],
        tradeAllowance: 0,
        tradeValuationId: null,
      },
      activePrograms: [
        { programId: "p1", programCode: "CIL-Q2", programType: "cash_in_lieu", programName: "Q2 Cash", brandName: "ASV" },
      ],
    });
    expect(evaluateCoachRules(c).find((r) => r.ruleId === "active_programs")).toBeUndefined();
  });

  test("info tier with 1-2 active programs", () => {
    const c = ctx({
      activePrograms: [
        { programId: "p1", programCode: "CIL-Q2", programType: "cash_in_lieu",      programName: "Q2", brandName: "ASV" },
        { programId: "p2", programCode: "LRF-Q2", programType: "low_rate_financing", programName: "Q2", brandName: "ASV" },
      ],
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "active_programs");
    expect(r?.severity).toBe("info");
  });

  test("warning tier with ≥3 active programs", () => {
    const c = ctx({
      activePrograms: [
        { programId: "p1", programCode: "A", programType: "cash_in_lieu",       programName: "A", brandName: "ASV" },
        { programId: "p2", programCode: "B", programType: "low_rate_financing", programName: "B", brandName: "ASV" },
        { programId: "p3", programCode: "C", programType: "gmu_rebate",         programName: "C", brandName: "ASV" },
      ],
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "active_programs");
    expect(r?.severity).toBe("warning");
  });

  test("body groups programs by brand", () => {
    const c = ctx({
      activePrograms: [
        { programId: "p1", programCode: "A", programType: "cash_in_lieu", programName: "A", brandName: "ASV" },
        { programId: "p2", programCode: "B", programType: "cash_in_lieu", programName: "B", brandName: "Barko" },
      ],
    });
    const r = evaluateCoachRules(c).find((r) => r.ruleId === "active_programs");
    expect(r?.body).toContain("ASV:");
    expect(r?.body).toContain("Barko:");
  });
});

describe("registry behavior", () => {
  test("severity sort: critical > warning > info", () => {
    // Force both rules to fire at different severities
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 12 }, // critical
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: false },
      activePrograms: [
        { programId: "p1", programCode: "A", programType: "cash_in_lieu", programName: "A", brandName: "ASV" },
      ], // info
    });
    const results = evaluateCoachRules(c);
    expect(results.map((r) => r.severity)).toEqual(["critical", "info"]);
  });

  test("dismissed rule ids are filtered out", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 12 },
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: false },
      activePrograms: [
        { programId: "p1", programCode: "A", programType: "cash_in_lieu", programName: "A", brandName: "ASV" },
      ],
    });
    const results = evaluateCoachRules(c, new Set(["margin_baseline"]));
    expect(results.map((r) => r.ruleId)).toEqual(["active_programs"]);
  });

  test("cap at MAX_VISIBLE_SUGGESTIONS", () => {
    // If we had more than MAX rules, the registry should cap.
    // Today there are only 2 rules so this is trivially satisfied, but the
    // assertion is still meaningful: behavior will hold as rules are added.
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 12 },
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: false },
      activePrograms: [
        { programId: "p1", programCode: "A", programType: "cash_in_lieu", programName: "A", brandName: "ASV" },
      ],
    });
    const results = evaluateCoachRules(c);
    expect(results.length).toBeLessThanOrEqual(MAX_VISIBLE_SUGGESTIONS);
  });

  test("MAX_VISIBLE_SUGGESTIONS is the expected cap", () => {
    expect(MAX_VISIBLE_SUGGESTIONS).toBe(3);
  });

  describe("similar_deals rule", () => {
    const baseSd = {
      priceBandLow: 65_000, priceBandHigh: 135_000,
    };

    test("silent when similarDeals is null", () => {
      const c = ctx({ similarDeals: null });
      expect(evaluateCoachRules(c).find((r) => r.ruleId === "similar_deals")).toBeUndefined();
    });

    test("silent when closedSampleSize < 3", () => {
      const c = ctx({
        similarDeals: {
          sampleSize: 2, closedSampleSize: 2, winRatePct: 100,
          avgWinMarginPct: 22, medianWinMarginPct: 22, ...baseSd,
        },
      });
      expect(evaluateCoachRules(c).find((r) => r.ruleId === "similar_deals")).toBeUndefined();
    });

    test("info tier when draft margin tracks with winners (±1 pt)", () => {
      const c = ctx({
        computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 100_000, marginAmount: 0, marginPct: 21.5 },
        similarDeals: {
          sampleSize: 5, closedSampleSize: 5, winRatePct: 60,
          avgWinMarginPct: 22, medianWinMarginPct: 22, ...baseSd,
        },
      });
      const r = evaluateCoachRules(c).find((rr) => rr.ruleId === "similar_deals");
      expect(r?.severity).toBe("info");
    });

    test("warning when 1–4 pts below winning avg", () => {
      const c = ctx({
        computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 100_000, marginAmount: 0, marginPct: 19 },
        similarDeals: {
          sampleSize: 5, closedSampleSize: 5, winRatePct: 60,
          avgWinMarginPct: 22, medianWinMarginPct: 22, ...baseSd,
        },
      });
      const r = evaluateCoachRules(c).find((rr) => rr.ruleId === "similar_deals");
      expect(r?.severity).toBe("warning");
    });

    test("critical when >4 pts below winning avg", () => {
      const c = ctx({
        computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 100_000, marginAmount: 0, marginPct: 15 },
        similarDeals: {
          sampleSize: 5, closedSampleSize: 5, winRatePct: 60,
          avgWinMarginPct: 22, medianWinMarginPct: 22, ...baseSd,
        },
      });
      const r = evaluateCoachRules(c).find((rr) => rr.ruleId === "similar_deals");
      expect(r?.severity).toBe("critical");
    });

    test("informational fallback when no win-margin data", () => {
      const c = ctx({
        computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 100_000, marginAmount: 0, marginPct: 18 },
        similarDeals: {
          sampleSize: 4, closedSampleSize: 4, winRatePct: 75,
          avgWinMarginPct: null, medianWinMarginPct: null, ...baseSd,
        },
      });
      const r = evaluateCoachRules(c).find((rr) => rr.ruleId === "similar_deals");
      expect(r?.severity).toBe("info");
      expect(r?.title).toMatch(/comparable|win/i);
      expect(r?.body).toMatch(/no margin data|75%/);
    });

    test("fallback when current margin not yet priced", () => {
      const c = ctx({
        computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 100_000, marginAmount: 0, marginPct: 0 },
        similarDeals: {
          sampleSize: 4, closedSampleSize: 4, winRatePct: 80,
          avgWinMarginPct: 22, medianWinMarginPct: 22, ...baseSd,
        },
      });
      const r = evaluateCoachRules(c).find((rr) => rr.ruleId === "similar_deals");
      expect(r?.severity).toBe("info");
    });

    test("metrics capture the full snapshot for training", () => {
      const c = ctx({
        computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 100_000, marginAmount: 0, marginPct: 15 },
        similarDeals: {
          sampleSize: 6, closedSampleSize: 5, winRatePct: 60,
          avgWinMarginPct: 22, medianWinMarginPct: 21, ...baseSd,
        },
      });
      const r = evaluateCoachRules(c).find((rr) => rr.ruleId === "similar_deals");
      expect(r?.metrics?.closed_sample_size).toBe(5);
      expect(r?.metrics?.win_rate_pct).toBe(60);
      expect(r?.metrics?.avg_win_margin_pct).toBe(22);
      expect(r?.metrics?.current_margin_pct).toBe(15);
      expect(r?.metrics?.delta_pts).toBe(-7);
    });
  });

  test("rule result contract: each has required fields", () => {
    const c = ctx({
      computed: { equipmentTotal: 0, attachmentTotal: 0, subtotal: 0, netTotal: 0, marginAmount: 0, marginPct: 12 },
      marginBaseline: { medianPct: 18, sampleSize: 25, usingTeamFallback: false },
      activePrograms: [
        { programId: "p1", programCode: "A", programType: "cash_in_lieu", programName: "A", brandName: "ASV" },
      ],
    });
    const results: RuleResult[] = evaluateCoachRules(c);
    for (const r of results) {
      expect(r.ruleId.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.why.length).toBeGreaterThan(0);
      expect(["critical", "warning", "info"]).toContain(r.severity);
    }
  });
});
