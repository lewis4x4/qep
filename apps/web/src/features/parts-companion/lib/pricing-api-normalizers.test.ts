import { describe, expect, test } from "bun:test";
import {
  normalizeAppliedSuggestionsResult,
  normalizeDismissedSuggestionsResult,
  normalizeGeneratePricingSuggestionsResult,
  normalizePricingRule,
  normalizePricingRuleRows,
  normalizePricingSuggestionRows,
  normalizePricingSummary,
  normalizeRulePreview,
} from "./pricing-api-normalizers";

const validRule = {
  id: "rule-1",
  name: "Target margin",
  description: "Keep margins up",
  scope_type: "vendor",
  scope_value: "VEND",
  rule_type: "target_margin_pct",
  min_margin_pct: "0.2",
  target_margin_pct: "0.3",
  markup_multiplier: "1.4",
  markup_floor_cents: "500",
  price_target: "pricing_level_1",
  tolerance_pct: "0.05",
  auto_apply: true,
  is_active: true,
  priority: "10",
  effective_from: "2026-05-03",
  effective_until: null,
};

const validSuggestion = {
  id: "suggestion-1",
  part_number: "P-100",
  current_sell: "100",
  suggested_sell: "125",
  delta_dollars: "25",
  delta_pct: "0.25",
  current_margin_pct: "0.1",
  suggested_margin_pct: "0.25",
  reason: "Below target",
  signal: "margin",
  created_at: "2026-05-03T12:00:00.000Z",
};

describe("pricing API normalizers", () => {
  test("normalizes pricing rule rows and validates enums", () => {
    expect(normalizePricingRuleRows([
      validRule,
      {
        ...validRule,
        id: "rule-2",
        scope_type: "bad",
        rule_type: "bad",
        price_target: "bad",
        auto_apply: "yes",
        is_active: "true",
        priority: "not numeric",
      },
      { id: "bad", name: "Missing effective date" },
    ])).toEqual([
      {
        id: "rule-1",
        name: "Target margin",
        description: "Keep margins up",
        scope_type: "vendor",
        scope_value: "VEND",
        rule_type: "target_margin_pct",
        min_margin_pct: 0.2,
        target_margin_pct: 0.3,
        markup_multiplier: 1.4,
        markup_floor_cents: 500,
        price_target: "pricing_level_1",
        tolerance_pct: 0.05,
        auto_apply: true,
        is_active: true,
        priority: 10,
        effective_from: "2026-05-03",
        effective_until: null,
      },
      {
        id: "rule-2",
        name: "Target margin",
        description: "Keep margins up",
        scope_type: "global",
        scope_value: "VEND",
        rule_type: "target_margin_pct",
        min_margin_pct: 0.2,
        target_margin_pct: 0.3,
        markup_multiplier: 1.4,
        markup_floor_cents: 500,
        price_target: "all_levels",
        tolerance_pct: 0.05,
        auto_apply: false,
        is_active: false,
        priority: 0,
        effective_from: "2026-05-03",
        effective_until: null,
      },
    ]);

    expect(normalizePricingRule(null)).toBeNull();
  });

  test("normalizes pricing suggestions and filters malformed rows", () => {
    expect(normalizePricingSuggestionRows([
      validSuggestion,
      { id: "bad", part_number: "P-101" },
    ])).toEqual([
      {
        id: "suggestion-1",
        part_number: "P-100",
        current_sell: 100,
        suggested_sell: 125,
        delta_dollars: 25,
        delta_pct: 0.25,
        current_margin_pct: 0.1,
        suggested_margin_pct: 0.25,
        reason: "Below target",
        signal: "margin",
        created_at: "2026-05-03T12:00:00.000Z",
      },
    ]);
  });

  test("normalizes pricing summary RPC payloads", () => {
    expect(normalizePricingSummary({
      kpis: {
        active_rules: "2",
        pending_suggestions: "3",
        pending_revenue_impact: "4000",
        applied_last_30d: "5",
        parts_out_of_tolerance: "6",
      },
      active_rules: [validRule],
      top_pending_suggestions: [validSuggestion],
    })).toEqual({
      kpis: {
        active_rules: 2,
        pending_suggestions: 3,
        pending_revenue_impact: 4000,
        applied_last_30d: 5,
        parts_out_of_tolerance: 6,
      },
      active_rules: [normalizePricingRule(validRule)],
      top_pending_suggestions: normalizePricingSuggestionRows([validSuggestion]),
    });
  });

  test("normalizes rule preview samples and defaults malformed metrics", () => {
    expect(normalizeRulePreview({
      rule_id: "rule-1",
      parts_in_scope: "100",
      parts_out_of_tolerance: "10",
      parts_to_increase: "8",
      parts_to_decrease: "2",
      avg_delta_pct: "0.12",
      max_increase_dollars: "50",
      max_decrease_dollars: "-5",
      total_delta_dollars: "500",
      sample: [
        {
          part_number: "P-100",
          current_sell_price: "100",
          target_sell_price: "125",
          delta_dollars: "25",
          delta_pct: "0.25",
          current_margin_pct: "0.1",
          target_margin_pct: "0.25",
        },
        { current_sell_price: "missing part number" },
      ],
    })).toEqual({
      rule_id: "rule-1",
      parts_in_scope: 100,
      parts_out_of_tolerance: 10,
      parts_to_increase: 8,
      parts_to_decrease: 2,
      avg_delta_pct: 0.12,
      max_increase_dollars: 50,
      max_decrease_dollars: -5,
      total_delta_dollars: 500,
      sample: [
        {
          part_number: "P-100",
          current_sell_price: 100,
          target_sell_price: 125,
          delta_dollars: 25,
          delta_pct: 0.25,
          current_margin_pct: 0.1,
          target_margin_pct: 0.25,
        },
      ],
    });
  });

  test("normalizes mutation RPC result counts", () => {
    expect(normalizeGeneratePricingSuggestionsResult({
      ok: true,
      suggestions_written: "12",
      batch_id: "batch-1",
      elapsed_ms: "42",
    })).toEqual({
      ok: true,
      suggestions_written: 12,
      batch_id: "batch-1",
      elapsed_ms: 42,
    });
    expect(normalizeAppliedSuggestionsResult({ applied_count: "3" })).toEqual({ applied_count: 3 });
    expect(normalizeDismissedSuggestionsResult({ dismissed_count: "4" })).toEqual({ dismissed_count: 4 });
  });

  test("returns safe empty collections for malformed pricing inputs", () => {
    expect(normalizePricingRuleRows(null)).toEqual([]);
    expect(normalizePricingSuggestionRows(undefined)).toEqual([]);
    expect(normalizePricingSummary(null)).toEqual({
      kpis: {
        active_rules: 0,
        pending_suggestions: 0,
        pending_revenue_impact: 0,
        applied_last_30d: 0,
        parts_out_of_tolerance: 0,
      },
      active_rules: [],
      top_pending_suggestions: [],
    });
  });
});
