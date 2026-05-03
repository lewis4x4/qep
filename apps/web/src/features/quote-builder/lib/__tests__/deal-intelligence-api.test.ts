import { describe, expect, test } from "bun:test";
import {
  aggregateReasonIntelligence,
  aggregateRuleAcceptance,
  aggregateSimilarDeals,
  brandMatches,
  bucketReason,
  buildSimilarDealsQuery,
  computePriceBand,
  deriveOutcomeFromStatus,
  normalizeCoachActionRows,
  normalizeMarginExceptionRows,
  normalizePackageOutcomeRows,
  normalizePackageStatusRows,
  normalizeSimilarPackageRows,
  normalizeSuppressionActionRows,
  type ReasonBucket,
} from "../deal-intelligence-api";

// ── row normalizers ──────────────────────────────────────────────────────

describe("deal intelligence row normalizers", () => {
  test("normalizes similar package rows and numeric strings", () => {
    expect(normalizeSimilarPackageRows([
      {
        id: "pkg-1",
        equipment: [{ make: "ASV" }],
        net_total: "100000",
        margin_pct: "22.5",
        status: "accepted",
        created_at: "2026-05-03T12:00:00.000Z",
      },
      { id: "bad", status: "draft" },
    ])).toEqual([
      {
        id: "pkg-1",
        equipment: [{ make: "ASV" }],
        net_total: 100000,
        margin_pct: 22.5,
        status: "accepted",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes package outcomes and rejects invalid outcome enums", () => {
    expect(normalizePackageOutcomeRows([
      { quote_package_id: "pkg-1", outcome: "won" },
      { quote_package_id: "pkg-2", outcome: "bad" },
      { outcome: "lost" },
    ])).toEqual([{ quote_package_id: "pkg-1", outcome: "won" }]);
  });

  test("normalizes exception, status, action, and suppression rows", () => {
    expect(normalizeMarginExceptionRows([
      { quote_package_id: "pkg-1", reason: "competitor match", estimated_gap_cents: "4500", created_at: "2026-05-03T12:00:00.000Z" },
      { quote_package_id: "bad", reason: "missing date" },
    ])).toEqual([
      { quote_package_id: "pkg-1", reason: "competitor match", estimated_gap_cents: 4500, created_at: "2026-05-03T12:00:00.000Z" },
    ]);

    expect(normalizePackageStatusRows([{ id: "pkg-1", status: "accepted" }, { id: "bad" }]))
      .toEqual([{ id: "pkg-1", status: "accepted" }]);

    expect(normalizeCoachActionRows([{ rule_id: "margin_baseline", action: "applied" }, { action: "dismissed" }]))
      .toEqual([{ rule_id: "margin_baseline", action: "applied" }]);

    expect(normalizeSuppressionActionRows([{ rule_id: "active_programs" }, { rule_id: "" }]))
      .toEqual([{ rule_id: "active_programs" }]);
  });
});

// ── computePriceBand ─────────────────────────────────────────────────────

describe("computePriceBand", () => {
  test("default ±35% band", () => {
    expect(computePriceBand(100_000)).toEqual({ priceBandLow: 65_000, priceBandHigh: 135_000 });
  });

  test("custom width", () => {
    expect(computePriceBand(100_000, 0.5)).toEqual({ priceBandLow: 50_000, priceBandHigh: 150_000 });
  });

  test("rounds to whole", () => {
    expect(computePriceBand(100_001)).toEqual({ priceBandLow: 65_001, priceBandHigh: 135_001 });
  });

  test("non-finite / non-positive → full range", () => {
    expect(computePriceBand(0).priceBandLow).toBe(0);
    expect(computePriceBand(-1).priceBandHigh).toBe(Number.MAX_SAFE_INTEGER);
    expect(computePriceBand(Number.NaN).priceBandHigh).toBe(Number.MAX_SAFE_INTEGER);
  });
});

// ── brandMatches ─────────────────────────────────────────────────────────

describe("brandMatches", () => {
  test("null brand → always match", () => {
    expect(brandMatches([{ make: "ASV" }], null)).toBe(true);
  });

  test("empty brand → match", () => {
    expect(brandMatches([{ make: "ASV" }], "  ")).toBe(true);
  });

  test("non-array equipment → no match when brand specified", () => {
    expect(brandMatches(null, "ASV")).toBe(false);
  });

  test("case-insensitive substring match", () => {
    expect(brandMatches([{ make: "ASV Holdings" }], "asv")).toBe(true);
    expect(brandMatches([{ make: "asv" }], "ASV")).toBe(true);
  });

  test("no match across brand", () => {
    expect(brandMatches([{ make: "CAT" }], "ASV")).toBe(false);
  });

  test("bi-directional contains", () => {
    // rep typed "ASV Holdings Inc." as the brand; quote has "ASV"
    expect(brandMatches([{ make: "ASV" }], "ASV Holdings Inc.")).toBe(true);
  });
});

// ── deriveOutcomeFromStatus ──────────────────────────────────────────────

describe("deriveOutcomeFromStatus", () => {
  test("accepted → won", () => expect(deriveOutcomeFromStatus("accepted")).toBe("won"));
  test("rejected → lost", () => expect(deriveOutcomeFromStatus("rejected")).toBe("lost"));
  test("expired → expired", () => expect(deriveOutcomeFromStatus("expired")).toBe("expired"));
  test("in-flight statuses → skipped", () => {
    expect(deriveOutcomeFromStatus("draft")).toBe("skipped");
    expect(deriveOutcomeFromStatus("ready")).toBe("skipped");
    expect(deriveOutcomeFromStatus("sent")).toBe("skipped");
    expect(deriveOutcomeFromStatus("viewed")).toBe("skipped");
  });
});

// ── bucketReason ─────────────────────────────────────────────────────────

describe("bucketReason", () => {
  const cases: Array<[string | null, ReasonBucket]> = [
    [null, "other"],
    ["",   "other"],
    ["Competitive response",                  "competitive_response"],
    ["to beat competitor quote",              "competitive_response"],
    ["undercut rival by 5%",                  "competitive_response"],
    ["long-time customer",                    "customer_relationship"],
    ["loyal repeat buyer",                    "customer_relationship"],
    ["loss leader into service contract",     "strategic_loss_leader"],
    ["foot in the door for fleet",            "strategic_loss_leader"],
    ["fleet volume order",                    "volume_commitment"],
    ["multi-unit discount",                   "volume_commitment"],
    ["service agreement offsets margin",      "service_trade_in_offset"],
    ["trade-in accommodation",                "service_trade_in_offset"],
    ["inventory clearance",                   "other"],
  ];
  for (const [input, expected] of cases) {
    test(`"${input ?? "null"}" → ${expected}`, () => {
      expect(bucketReason(input)).toBe(expected);
    });
  }
});

// ── aggregateSimilarDeals ────────────────────────────────────────────────

describe("aggregateSimilarDeals", () => {
  test("empty → null stats", () => {
    const out = aggregateSimilarDeals([], 100, 1000);
    expect(out).toEqual({
      sampleSize: 0,
      closedSampleSize: 0,
      winRatePct: null,
      avgWinMarginPct: null,
      medianWinMarginPct: null,
      priceBandLow: 100,
      priceBandHigh: 1000,
    });
  });

  test("only in-flight → closedSampleSize 0, winRate null", () => {
    const out = aggregateSimilarDeals([
      { marginPct: 20, outcome: "skipped" },
      { marginPct: 22, outcome: "skipped" },
    ], 0, 99);
    expect(out.sampleSize).toBe(2);
    expect(out.closedSampleSize).toBe(0);
    expect(out.winRatePct).toBeNull();
    expect(out.avgWinMarginPct).toBeNull();
  });

  test("mixed outcomes compute winRate on closed deals only", () => {
    const out = aggregateSimilarDeals([
      { marginPct: 20, outcome: "won" },
      { marginPct: 25, outcome: "won" },
      { marginPct: 15, outcome: "lost" },
      { marginPct: 10, outcome: "skipped" },  // excluded from closed
      { marginPct: 30, outcome: "expired" },  // excluded from closed
    ], 0, 99);
    expect(out.sampleSize).toBe(5);
    expect(out.closedSampleSize).toBe(3);
    expect(out.winRatePct).toBe(66.7); // 2/3
    // Win margins are 20 + 25 = avg 22.5
    expect(out.avgWinMarginPct).toBe(22.5);
    expect(out.medianWinMarginPct).toBe(22.5);
  });

  test("null margins filtered from win-margin averages", () => {
    const out = aggregateSimilarDeals([
      { marginPct: 20, outcome: "won" },
      { marginPct: null, outcome: "won" },
      { marginPct: 10, outcome: "lost" },
    ], 0, 99);
    expect(out.avgWinMarginPct).toBe(20);
  });

  test("rounds avg and median to 1 decimal", () => {
    const out = aggregateSimilarDeals([
      { marginPct: 20.333, outcome: "won" },
      { marginPct: 22.666, outcome: "won" },
    ], 0, 99);
    expect(out.avgWinMarginPct).toBe(21.5);
    expect(out.medianWinMarginPct).toBe(21.5);
  });
});

// ── aggregateReasonIntelligence ──────────────────────────────────────────

describe("aggregateReasonIntelligence", () => {
  test("empty → empty stats", () => {
    expect(aggregateReasonIntelligence([])).toEqual({ stats: [], totalSamples: 0 });
  });

  test("drops buckets under minimum sample threshold", () => {
    const rows = [
      { bucket: "other" as ReasonBucket, outcome: "won" as const, gapCents: 100 },
      { bucket: "other" as ReasonBucket, outcome: "won" as const, gapCents: 200 },
    ];
    const out = aggregateReasonIntelligence(rows);
    // 2 samples < MIN_BUCKET_SAMPLES=3 → drop
    expect(out.stats).toHaveLength(0);
    expect(out.totalSamples).toBe(2);
  });

  test("aggregates win rate + gap avg per bucket", () => {
    const rows = [
      { bucket: "competitive_response" as ReasonBucket, outcome: "won" as const,  gapCents: 500 },
      { bucket: "competitive_response" as ReasonBucket, outcome: "lost" as const, gapCents: 800 },
      { bucket: "competitive_response" as ReasonBucket, outcome: "lost" as const, gapCents: 1000 },
      { bucket: "customer_relationship" as ReasonBucket, outcome: "won" as const,  gapCents: 400 },
      { bucket: "customer_relationship" as ReasonBucket, outcome: "won" as const,  gapCents: 600 },
      { bucket: "customer_relationship" as ReasonBucket, outcome: "won" as const,  gapCents: 500 },
    ];
    const out = aggregateReasonIntelligence(rows);
    expect(out.totalSamples).toBe(6);
    expect(out.stats).toHaveLength(2);

    const [first, second] = out.stats;
    // Higher winRate first
    expect(first.bucket).toBe("customer_relationship");
    expect(first.winRatePct).toBe(100);
    expect(first.avgGapCents).toBe(500);
    expect(second.bucket).toBe("competitive_response");
    expect(second.winRatePct).toBe(33.3);
    expect(second.avgGapCents).toBe(767);  // (500 + 800 + 1000) / 3 = 766.6 → 767
  });

  test("nulls sort last", () => {
    const rows = [
      // bucket A: 3 wins, 0 losses
      { bucket: "competitive_response" as ReasonBucket, outcome: "won" as const, gapCents: 0 },
      { bucket: "competitive_response" as ReasonBucket, outcome: "won" as const, gapCents: 0 },
      { bucket: "competitive_response" as ReasonBucket, outcome: "won" as const, gapCents: 0 },
      // bucket B: 3 in-flight — no closed → null winRate
      { bucket: "customer_relationship" as ReasonBucket, outcome: "skipped" as const, gapCents: 0 },
      { bucket: "customer_relationship" as ReasonBucket, outcome: "skipped" as const, gapCents: 0 },
      { bucket: "customer_relationship" as ReasonBucket, outcome: "skipped" as const, gapCents: 0 },
    ];
    const out = aggregateReasonIntelligence(rows);
    expect(out.stats[0].bucket).toBe("competitive_response");
    expect(out.stats[1].bucket).toBe("customer_relationship");
    expect(out.stats[1].winRatePct).toBeNull();
  });
});

// ── aggregateRuleAcceptance ──────────────────────────────────────────────

describe("aggregateRuleAcceptance", () => {
  test("empty → empty", () => {
    expect(aggregateRuleAcceptance([])).toEqual([]);
  });

  test("counts + computes acceptance rate", () => {
    const rows: Array<{ rule_id: string; action: string | null }> = [
      { rule_id: "margin_baseline", action: "applied" },
      { rule_id: "margin_baseline", action: "applied" },
      { rule_id: "margin_baseline", action: "dismissed" },
      { rule_id: "margin_baseline", action: null }, // shown but unresolved
      { rule_id: "active_programs", action: "dismissed" },
    ];
    const out = aggregateRuleAcceptance(rows);
    const byId = Object.fromEntries(out.map((r) => [r.ruleId, r]));
    expect(byId.margin_baseline).toMatchObject({
      timesShown: 4,
      timesApplied: 2,
      timesDismissed: 1,
      acceptanceRatePct: 66.7,  // 2 / (2 + 1)
    });
    expect(byId.active_programs).toMatchObject({
      timesShown: 1,
      timesApplied: 0,
      timesDismissed: 1,
      acceptanceRatePct: 0,
    });
  });

  test("null acceptance when no applied/dismissed yet", () => {
    const rows = [{ rule_id: "x", action: null }, { rule_id: "x", action: null }];
    expect(aggregateRuleAcceptance(rows)[0].acceptanceRatePct).toBeNull();
  });
});

// ── buildSimilarDealsQuery ───────────────────────────────────────────────

describe("buildSimilarDealsQuery", () => {
  const base = {
    entryMode: "manual" as const,
    branchSlug: "hq",
    recommendation: null,
    voiceSummary: null,
    equipment: [] as Array<{ kind: "equipment"; title: string; make?: string; model?: string; quantity: number; unitPrice: number }>,
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
  };

  test("no equipment → null", () => {
    expect(buildSimilarDealsQuery(base as never, 100_000)).toBeNull();
  });

  test("zero or negative net → null", () => {
    const draft = { ...base, equipment: [{ kind: "equipment", title: "RT-135", make: "ASV", quantity: 1, unitPrice: 100_000 }] };
    expect(buildSimilarDealsQuery(draft as never, 0)).toBeNull();
    expect(buildSimilarDealsQuery(draft as never, -50)).toBeNull();
  });

  test("picks primary equipment make as brand", () => {
    const draft = { ...base, equipment: [{ kind: "equipment", title: "RT-135", make: "ASV", quantity: 1, unitPrice: 100_000 }] };
    const q = buildSimilarDealsQuery(draft as never, 100_000);
    expect(q).toEqual({ brandName: "ASV", netTotal: 100_000 });
  });

  test("missing make → brand null", () => {
    const draft = { ...base, equipment: [{ kind: "equipment", title: "Something", quantity: 1, unitPrice: 50_000 }] };
    const q = buildSimilarDealsQuery(draft as never, 50_000);
    expect(q?.brandName).toBeNull();
  });
});
