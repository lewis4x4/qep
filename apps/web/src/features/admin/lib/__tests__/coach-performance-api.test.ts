import { describe, expect, test } from "bun:test";
import {
  aggregateCoachPerformance,
  normalizeCoachActionRows,
  normalizePackageStatusRows,
  normalizeProfileDisplayRows,
  wouldDemoteAt,
  wouldSuppressAt,
  type RulePerformanceRow,
} from "../coach-performance-api";

type ActionSeed = {
  rule_id: string;
  action: string | null;
  shown_by: string | null;
  quote_package_id: string;
};

const windowFrom = new Date("2026-01-20T00:00:00Z");
const windowTo   = new Date("2026-04-20T00:00:00Z");

function build(
  actions: ActionSeed[],
  statusByPkg: Record<string, string> = {},
  nameByRep: Record<string, string> = {},
) {
  return aggregateCoachPerformance(
    actions,
    new Map(Object.entries(statusByPkg)),
    new Map(Object.entries(nameByRep)),
    windowFrom,
    windowTo,
  );
}

// ── Source row normalizers ───────────────────────────────────────────────

describe("coach performance source normalizers", () => {
  test("normalizes action rows and filters malformed rollup inputs", () => {
    expect(normalizeCoachActionRows([
      {
        rule_id: "margin-floor",
        action: "applied",
        shown_by: "rep-1",
        shown_at: "2026-04-20T12:00:00Z",
        quote_package_id: "pkg-1",
      },
      { rule_id: "bad-date", shown_at: "not-a-date", quote_package_id: "pkg-2" },
      { rule_id: "", shown_at: "2026-04-20T12:00:00Z", quote_package_id: "pkg-3" },
      { rule_id: "missing-package", shown_at: "2026-04-20T12:00:00Z" },
    ])).toEqual([
      {
        rule_id: "margin-floor",
        action: "applied",
        shown_by: "rep-1",
        shown_at: "2026-04-20T12:00:00Z",
        quote_package_id: "pkg-1",
      },
    ]);
  });

  test("normalizes package statuses and profile display rows", () => {
    expect(normalizePackageStatusRows([
      { id: "pkg-1", status: "accepted" },
      { id: "pkg-2", status: "" },
      { status: "rejected" },
    ])).toEqual([{ id: "pkg-1", status: "accepted" }]);

    expect(normalizeProfileDisplayRows([
      { id: "rep-1", display_name: "Alice", full_name: "Alice Rep", email: "alice@example.com" },
      { id: "rep-2", display_name: 42, full_name: null, email: "rep2@example.com" },
      { display_name: "Missing id" },
    ])).toEqual([
      { id: "rep-1", display_name: "Alice", full_name: "Alice Rep", email: "alice@example.com" },
      { id: "rep-2", display_name: null, full_name: null, email: "rep2@example.com" },
    ]);
  });
});

// ── aggregateCoachPerformance — empty + headline ─────────────────────────

describe("aggregateCoachPerformance", () => {
  test("empty → zero totals, null acceptance", () => {
    const out = build([]);
    expect(out.totalActions).toBe(0);
    expect(out.totalApplied).toBe(0);
    expect(out.totalDismissed).toBe(0);
    expect(out.acceptedPct).toBeNull();
    expect(out.rules).toEqual([]);
    expect(out.repDismissals).toEqual([]);
    expect(out.windowFrom).toBe(windowFrom.toISOString());
    // Pure aggregator always reports non-truncated, error-free — the
    // wrapper fills these from Supabase call outcomes.
    expect(out.truncated).toBe(false);
    expect(out.error).toBeNull();
  });

  test("computes headline totals + acceptance", () => {
    const out = build([
      { rule_id: "r1", action: "applied",   shown_by: "u1", quote_package_id: "p1" },
      { rule_id: "r1", action: "applied",   shown_by: "u1", quote_package_id: "p2" },
      { rule_id: "r1", action: "dismissed", shown_by: "u2", quote_package_id: "p3" },
      { rule_id: "r2", action: null,        shown_by: "u1", quote_package_id: "p4" },
    ]);
    expect(out.totalActions).toBe(4);
    expect(out.totalApplied).toBe(2);
    expect(out.totalDismissed).toBe(1);
    expect(out.acceptedPct).toBe(66.7);
  });
});

// ── Per-rule rollup ──────────────────────────────────────────────────────

describe("per-rule rollup", () => {
  test("sorts by timesShown desc", () => {
    const out = build([
      { rule_id: "loud",  action: "applied", shown_by: "u1", quote_package_id: "p1" },
      { rule_id: "loud",  action: null,      shown_by: "u1", quote_package_id: "p2" },
      { rule_id: "loud",  action: null,      shown_by: "u1", quote_package_id: "p3" },
      { rule_id: "quiet", action: null,      shown_by: "u1", quote_package_id: "p4" },
    ]);
    expect(out.rules[0].ruleId).toBe("loud");
    expect(out.rules[0].timesShown).toBe(3);
    expect(out.rules[1].ruleId).toBe("quiet");
  });

  test("tracks applied/dismissed/unresolved counts", () => {
    const out = build([
      { rule_id: "r", action: "applied",   shown_by: "u1", quote_package_id: "p1" },
      { rule_id: "r", action: "dismissed", shown_by: "u2", quote_package_id: "p2" },
      { rule_id: "r", action: null,        shown_by: "u3", quote_package_id: "p3" },
    ]);
    const r = out.rules[0];
    expect(r.timesShown).toBe(3);
    expect(r.timesApplied).toBe(1);
    expect(r.timesDismissed).toBe(1);
    expect(r.timesUnresolved).toBe(1);
    expect(r.acceptanceRatePct).toBe(50);
  });

  test("winRate when shown computes on closed packages", () => {
    const out = build(
      [
        { rule_id: "r", action: "applied",   shown_by: "u1", quote_package_id: "p1" },
        { rule_id: "r", action: "dismissed", shown_by: "u1", quote_package_id: "p2" },
        { rule_id: "r", action: null,        shown_by: "u1", quote_package_id: "p3" },
      ],
      { p1: "accepted", p2: "rejected", p3: "draft" }, // p3 in-flight, excluded
    );
    expect(out.rules[0].winRateWhenShownPct).toBe(50);
  });

  test("winRate when applied is the subset where action='applied'", () => {
    const out = build(
      [
        { rule_id: "r", action: "applied", shown_by: "u1", quote_package_id: "win-applied" },
        { rule_id: "r", action: "applied", shown_by: "u1", quote_package_id: "loss-applied" },
        { rule_id: "r", action: null,      shown_by: "u1", quote_package_id: "win-shown-only" },
      ],
      { "win-applied": "accepted", "loss-applied": "rejected", "win-shown-only": "accepted" },
    );
    const r = out.rules[0];
    // Shown: 2 wins, 1 loss → 66.7
    expect(r.winRateWhenShownPct).toBe(66.7);
    // Applied: 1 win, 1 loss → 50
    expect(r.winRateWhenAppliedPct).toBe(50);
    // Uplift: 50 - 66.7 = -16.7
    expect(r.upliftPts).toBe(-16.7);
  });

  test("uplift null when either side null", () => {
    const out = build([
      { rule_id: "r", action: null, shown_by: "u1", quote_package_id: "p1" },
    ]);
    expect(out.rules[0].upliftPts).toBeNull();
    expect(out.rules[0].winRateWhenShownPct).toBeNull();
  });
});

// ── Per-rep dismissal rollup ─────────────────────────────────────────────

describe("rep dismissal rollup", () => {
  test("counts only dismissals per rep", () => {
    const out = build(
      [
        { rule_id: "r1", action: "dismissed", shown_by: "u1", quote_package_id: "p1" },
        { rule_id: "r1", action: "dismissed", shown_by: "u1", quote_package_id: "p2" },
        { rule_id: "r2", action: "dismissed", shown_by: "u1", quote_package_id: "p3" },
        { rule_id: "r1", action: "dismissed", shown_by: "u2", quote_package_id: "p4" },
        { rule_id: "r1", action: "applied",   shown_by: "u1", quote_package_id: "p5" },
        { rule_id: "r1", action: null,        shown_by: "u1", quote_package_id: "p6" },
      ],
      {},
      { u1: "Alice Rep", u2: "Bob Rep" },
    );
    expect(out.repDismissals).toHaveLength(2);
    expect(out.repDismissals[0]).toMatchObject({
      repId: "u1", displayName: "Alice Rep",
      dismissalCount: 3, distinctRules: 2, topDismissedRule: "r1",
    });
    expect(out.repDismissals[1]).toMatchObject({
      repId: "u2", displayName: "Bob Rep", dismissalCount: 1,
    });
  });

  test("skips null shown_by (service-role actions)", () => {
    const out = build([
      { rule_id: "r", action: "dismissed", shown_by: null, quote_package_id: "p1" },
    ]);
    expect(out.repDismissals).toEqual([]);
  });

  test("sorts by dismissal count desc", () => {
    const out = build([
      { rule_id: "r", action: "dismissed", shown_by: "quiet", quote_package_id: "p1" },
      { rule_id: "r", action: "dismissed", shown_by: "loud",  quote_package_id: "p2" },
      { rule_id: "r", action: "dismissed", shown_by: "loud",  quote_package_id: "p3" },
      { rule_id: "r", action: "dismissed", shown_by: "loud",  quote_package_id: "p4" },
    ]);
    expect(out.repDismissals.map((r) => r.repId)).toEqual(["loud", "quiet"]);
  });
});

// ── Adaptive preview helpers ─────────────────────────────────────────────

function rule(partial: Partial<RulePerformanceRow>): RulePerformanceRow {
  return {
    ruleId: partial.ruleId ?? "r",
    timesShown: partial.timesShown ?? 20,
    timesApplied: 0,
    timesDismissed: 0,
    timesUnresolved: 0,
    acceptanceRatePct: partial.acceptanceRatePct ?? null,
    winRateWhenShownPct: null,
    winRateWhenAppliedPct: null,
    upliftPts: null,
  };
}

describe("wouldSuppressAt", () => {
  test("returns only below-threshold, above-confidence rules", () => {
    const rules = [
      rule({ ruleId: "killme",        timesShown: 20, acceptanceRatePct: 3 }),
      rule({ ruleId: "justabove",     timesShown: 20, acceptanceRatePct: 10 }),
      rule({ ruleId: "lowconf",       timesShown: 5,  acceptanceRatePct: 1 }),
      rule({ ruleId: "nullacceptance",timesShown: 20, acceptanceRatePct: null }),
    ];
    const out = wouldSuppressAt(rules, 5, 10);
    expect(out.map((r) => r.ruleId)).toEqual(["killme"]);
  });
});

describe("wouldDemoteAt", () => {
  test("returns rules between suppress and demote thresholds", () => {
    const rules = [
      rule({ ruleId: "suppress", timesShown: 20, acceptanceRatePct: 2 }),
      rule({ ruleId: "demoteA",  timesShown: 20, acceptanceRatePct: 10 }),
      rule({ ruleId: "demoteB",  timesShown: 20, acceptanceRatePct: 18 }),
      rule({ ruleId: "ok",       timesShown: 20, acceptanceRatePct: 60 }),
      rule({ ruleId: "lowconf",  timesShown: 5,  acceptanceRatePct: 10 }),
    ];
    const out = wouldDemoteAt(rules, 5, 20, 10);
    expect(out.map((r) => r.ruleId).sort()).toEqual(["demoteA", "demoteB"]);
  });
});
