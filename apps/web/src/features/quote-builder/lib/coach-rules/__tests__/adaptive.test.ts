import { describe, expect, test } from "bun:test";
import {
  applyAdaptiveAdjustments,
  classify,
  MIN_CONFIDENCE_SHOWS,
  SUPPRESS_BELOW_PCT,
  DEMOTE_BELOW_PCT,
  type AcceptanceSnapshot,
} from "../adaptive";
import type { RuleResult } from "../types";

function rule(partial: Partial<RuleResult>): RuleResult {
  return {
    ruleId:   partial.ruleId ?? "r",
    severity: partial.severity ?? "warning",
    title:    partial.title ?? "t",
    body:     partial.body ?? "b",
    why:      partial.why ?? "w",
    metrics:  partial.metrics,
    action:   partial.action,
  };
}

function stat(partial: Partial<AcceptanceSnapshot>): AcceptanceSnapshot {
  return {
    ruleId: partial.ruleId ?? "r",
    timesShown: partial.timesShown ?? 20,
    acceptanceRatePct: partial.acceptanceRatePct ?? null,
  };
}

// ── classify ─────────────────────────────────────────────────────────────

describe("classify", () => {
  test("no stats → unchanged", () => {
    const out = classify(rule({}), undefined);
    expect(out.action).toBe("unchanged");
    expect(out.acceptanceRatePct).toBeNull();
  });

  test("stats below MIN_CONFIDENCE_SHOWS → unchanged", () => {
    const out = classify(rule({}), stat({ timesShown: MIN_CONFIDENCE_SHOWS - 1, acceptanceRatePct: 0 }));
    expect(out.action).toBe("unchanged");
    expect(out.timesShown).toBe(MIN_CONFIDENCE_SHOWS - 1);
  });

  test("acceptanceRatePct null → unchanged even at high volume", () => {
    const out = classify(rule({}), stat({ timesShown: 50, acceptanceRatePct: null }));
    expect(out.action).toBe("unchanged");
  });

  test("below SUPPRESS_BELOW_PCT → suppressed", () => {
    const out = classify(rule({}), stat({ timesShown: 30, acceptanceRatePct: SUPPRESS_BELOW_PCT - 1 }));
    expect(out.action).toBe("suppressed");
  });

  test("boundary: exactly SUPPRESS_BELOW_PCT → demoted (not suppressed)", () => {
    const out = classify(rule({ severity: "critical" }), stat({ timesShown: 30, acceptanceRatePct: SUPPRESS_BELOW_PCT }));
    expect(out.action).toBe("demoted");
  });

  test("between SUPPRESS and DEMOTE → demoted", () => {
    const out = classify(rule({ severity: "critical" }), stat({ timesShown: 30, acceptanceRatePct: 10 }));
    expect(out.action).toBe("demoted");
    expect(out.rule.severity).toBe("warning");
  });

  test("warning demotes to info", () => {
    const out = classify(rule({ severity: "warning" }), stat({ timesShown: 30, acceptanceRatePct: 15 }));
    expect(out.rule.severity).toBe("info");
  });

  test("info stays info when demoted (lowest tier)", () => {
    const out = classify(rule({ severity: "info" }), stat({ timesShown: 30, acceptanceRatePct: 15 }));
    expect(out.action).toBe("demoted");
    expect(out.rule.severity).toBe("info");
  });

  test("boundary: exactly DEMOTE_BELOW_PCT → unchanged", () => {
    const out = classify(rule({}), stat({ timesShown: 30, acceptanceRatePct: DEMOTE_BELOW_PCT }));
    expect(out.action).toBe("unchanged");
  });

  test("above DEMOTE_BELOW_PCT → unchanged", () => {
    const out = classify(rule({ severity: "critical" }), stat({ timesShown: 30, acceptanceRatePct: 50 }));
    expect(out.action).toBe("unchanged");
    expect(out.rule.severity).toBe("critical");
  });

  test("demoted rule stamps metrics with original severity + pct", () => {
    const out = classify(rule({ severity: "critical" }), stat({ timesShown: 30, acceptanceRatePct: 12 }));
    expect(out.rule.metrics?.adaptive_demoted_from).toBe("critical");
    expect(out.rule.metrics?.adaptive_acceptance_pct).toBe(12);
  });

  test("demoted rule preserves the original metrics from the rule author", () => {
    const out = classify(
      rule({ severity: "critical", metrics: { sample_size: 42 } }),
      stat({ timesShown: 30, acceptanceRatePct: 12 }),
    );
    // Author-supplied metrics must be preserved alongside the adaptive stamps.
    expect(out.rule.metrics?.sample_size).toBe(42);
    expect(out.rule.metrics?.adaptive_demoted_from).toBe("critical");
  });
});

// ── applyAdaptiveAdjustments ─────────────────────────────────────────────

describe("applyAdaptiveAdjustments", () => {
  test("no stats → all rules pass through", () => {
    const rules = [rule({ ruleId: "a" }), rule({ ruleId: "b" })];
    const out = applyAdaptiveAdjustments(rules, []);
    expect(out.adjusted).toHaveLength(2);
    expect(out.actions.a.action).toBe("unchanged");
    expect(out.actions.b.action).toBe("unchanged");
  });

  test("suppressed rule dropped from adjusted[], still in actions map", () => {
    const rules = [rule({ ruleId: "a", severity: "warning" })];
    const out = applyAdaptiveAdjustments(rules, [
      stat({ ruleId: "a", timesShown: 50, acceptanceRatePct: 2 }),
    ]);
    expect(out.adjusted).toHaveLength(0);
    expect(out.actions.a.action).toBe("suppressed");
  });

  test("demoted rule carries new severity in adjusted[]", () => {
    const rules = [rule({ ruleId: "a", severity: "critical" })];
    const out = applyAdaptiveAdjustments(rules, [
      stat({ ruleId: "a", timesShown: 50, acceptanceRatePct: 12 }),
    ]);
    expect(out.adjusted[0].severity).toBe("warning");
    expect(out.actions.a.action).toBe("demoted");
  });

  test("mixed rules adjusted independently", () => {
    const rules = [
      rule({ ruleId: "keep",      severity: "critical" }),
      rule({ ruleId: "demote",    severity: "warning" }),
      rule({ ruleId: "suppress",  severity: "info" }),
      rule({ ruleId: "noStats",   severity: "warning" }),
    ];
    const stats: AcceptanceSnapshot[] = [
      stat({ ruleId: "keep",     timesShown: 50, acceptanceRatePct: 80 }),
      stat({ ruleId: "demote",   timesShown: 50, acceptanceRatePct: 15 }),
      stat({ ruleId: "suppress", timesShown: 50, acceptanceRatePct: 3  }),
      // noStats omitted
    ];
    const out = applyAdaptiveAdjustments(rules, stats);
    // suppress dropped
    expect(out.adjusted).toHaveLength(3);
    expect(out.adjusted.map((r) => r.ruleId).sort()).toEqual(["demote", "keep", "noStats"]);
    // action map covers all 4
    expect(out.actions.keep.action).toBe("unchanged");
    expect(out.actions.demote.action).toBe("demoted");
    expect(out.actions.suppress.action).toBe("suppressed");
    expect(out.actions.noStats.action).toBe("unchanged");
  });
});
