import type {
  PriceTarget,
  PricingRule,
  PricingRuleType,
  PricingSuggestion,
  PricingSummary,
  PricingScope,
  RulePreview,
} from "./pricing-api";

export type GeneratePricingSuggestionsResult = {
  ok: boolean;
  suggestions_written: number;
  batch_id: string;
  elapsed_ms: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function pricingScope(value: unknown): PricingScope {
  return value === "global" ||
    value === "vendor" ||
    value === "class" ||
    value === "category" ||
    value === "machine_code" ||
    value === "part"
    ? value
    : "global";
}

function pricingRuleType(value: unknown): PricingRuleType {
  return value === "min_margin_pct" ||
    value === "target_margin_pct" ||
    value === "markup_multiplier" ||
    value === "markup_with_floor"
    ? value
    : "target_margin_pct";
}

function priceTarget(value: unknown): PriceTarget {
  return value === "list_price" ||
    value === "pricing_level_1" ||
    value === "pricing_level_2" ||
    value === "pricing_level_3" ||
    value === "pricing_level_4" ||
    value === "all_levels"
    ? value
    : "all_levels";
}

export function normalizePricingRuleRows(rows: unknown): PricingRule[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePricingRule).filter((row): row is PricingRule => row !== null);
}

export function normalizePricingRule(value: unknown): PricingRule | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const name = nullableString(value.name);
  const effectiveFrom = nullableString(value.effective_from);
  if (!id || !name || !effectiveFrom) return null;
  return {
    id,
    name,
    description: nullableString(value.description),
    scope_type: pricingScope(value.scope_type),
    scope_value: nullableString(value.scope_value),
    rule_type: pricingRuleType(value.rule_type),
    min_margin_pct: numberValue(value.min_margin_pct),
    target_margin_pct: numberValue(value.target_margin_pct),
    markup_multiplier: numberValue(value.markup_multiplier),
    markup_floor_cents: numberValue(value.markup_floor_cents),
    price_target: priceTarget(value.price_target),
    tolerance_pct: numberValue(value.tolerance_pct) ?? 0,
    auto_apply: booleanValue(value.auto_apply),
    is_active: booleanValue(value.is_active),
    priority: numberValue(value.priority) ?? 0,
    effective_from: effectiveFrom,
    effective_until: nullableString(value.effective_until),
  };
}

export function normalizePricingSuggestionRows(rows: unknown): PricingSuggestion[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePricingSuggestion).filter((row): row is PricingSuggestion => row !== null);
}

function normalizePricingSuggestion(value: unknown): PricingSuggestion | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const partNumber = nullableString(value.part_number);
  const createdAt = nullableString(value.created_at);
  if (!id || !partNumber || !createdAt) return null;
  return {
    id,
    part_number: partNumber,
    current_sell: numberValue(value.current_sell),
    suggested_sell: numberValue(value.suggested_sell) ?? 0,
    delta_dollars: numberValue(value.delta_dollars),
    delta_pct: numberValue(value.delta_pct),
    current_margin_pct: numberValue(value.current_margin_pct),
    suggested_margin_pct: numberValue(value.suggested_margin_pct),
    reason: stringValue(value.reason, "Pricing suggestion"),
    signal: nullableString(value.signal),
    created_at: createdAt,
  };
}

export function normalizePricingSummary(value: unknown): PricingSummary {
  const record = objectValue(value);
  const kpis = objectValue(record.kpis);
  return {
    kpis: {
      active_rules: numberValue(kpis.active_rules) ?? 0,
      pending_suggestions: numberValue(kpis.pending_suggestions) ?? 0,
      pending_revenue_impact: numberValue(kpis.pending_revenue_impact) ?? 0,
      applied_last_30d: numberValue(kpis.applied_last_30d) ?? 0,
      parts_out_of_tolerance: numberValue(kpis.parts_out_of_tolerance) ?? 0,
    },
    active_rules: normalizePricingRuleRows(record.active_rules),
    top_pending_suggestions: normalizePricingSuggestionRows(record.top_pending_suggestions),
  };
}

export function normalizeRulePreview(value: unknown): RulePreview {
  const record = objectValue(value);
  return {
    rule_id: stringValue(record.rule_id),
    parts_in_scope: numberValue(record.parts_in_scope) ?? 0,
    parts_out_of_tolerance: numberValue(record.parts_out_of_tolerance) ?? 0,
    parts_to_increase: numberValue(record.parts_to_increase) ?? 0,
    parts_to_decrease: numberValue(record.parts_to_decrease) ?? 0,
    avg_delta_pct: numberValue(record.avg_delta_pct),
    max_increase_dollars: numberValue(record.max_increase_dollars),
    max_decrease_dollars: numberValue(record.max_decrease_dollars),
    total_delta_dollars: numberValue(record.total_delta_dollars) ?? 0,
    sample: Array.isArray(record.sample)
      ? record.sample.map(normalizeRulePreviewSample).filter((row): row is RulePreview["sample"][number] => row !== null)
      : [],
  };
}

function normalizeRulePreviewSample(value: unknown): RulePreview["sample"][number] | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  return {
    part_number: partNumber,
    current_sell_price: numberValue(value.current_sell_price) ?? 0,
    target_sell_price: numberValue(value.target_sell_price) ?? 0,
    delta_dollars: numberValue(value.delta_dollars) ?? 0,
    delta_pct: numberValue(value.delta_pct) ?? 0,
    current_margin_pct: numberValue(value.current_margin_pct) ?? 0,
    target_margin_pct: numberValue(value.target_margin_pct) ?? 0,
  };
}

export function normalizeGeneratePricingSuggestionsResult(value: unknown): GeneratePricingSuggestionsResult {
  const record = objectValue(value);
  return {
    ok: booleanValue(record.ok),
    suggestions_written: numberValue(record.suggestions_written) ?? 0,
    batch_id: stringValue(record.batch_id),
    elapsed_ms: numberValue(record.elapsed_ms) ?? 0,
  };
}

export function normalizeAppliedSuggestionsResult(value: unknown): { applied_count: number } {
  return { applied_count: numberValue(objectValue(value).applied_count) ?? 0 };
}

export function normalizeDismissedSuggestionsResult(value: unknown): { dismissed_count: number } {
  return { dismissed_count: numberValue(objectValue(value).dismissed_count) ?? 0 };
}
