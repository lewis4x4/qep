// ============================================================
// Parts Intelligence — Pricing Rules Engine API (Slice P2.5)
// ============================================================

import { supabase } from "../../../lib/supabase";

export type PricingScope = "global" | "vendor" | "class" | "category" | "machine_code" | "part";
export type PricingRuleType = "min_margin_pct" | "target_margin_pct" | "markup_multiplier" | "markup_with_floor";
export type PriceTarget = "list_price" | "pricing_level_1" | "pricing_level_2" | "pricing_level_3" | "pricing_level_4" | "all_levels";
export type SuggestionStatus = "pending" | "approved" | "applied" | "dismissed" | "expired";

export interface PricingRule {
  id: string;
  name: string;
  description: string | null;
  scope_type: PricingScope;
  scope_value: string | null;
  rule_type: PricingRuleType;
  min_margin_pct: number | null;
  target_margin_pct: number | null;
  markup_multiplier: number | null;
  markup_floor_cents: number | null;
  price_target: PriceTarget;
  tolerance_pct: number;
  auto_apply: boolean;
  is_active: boolean;
  priority: number;
  effective_from: string;
  effective_until: string | null;
}

export interface PricingSuggestion {
  id: string;
  part_number: string;
  current_sell: number | null;
  suggested_sell: number;
  delta_dollars: number | null;
  delta_pct: number | null;
  current_margin_pct: number | null;
  suggested_margin_pct: number | null;
  reason: string;
  signal: string | null;
  created_at: string;
}

export interface PricingKpis {
  active_rules: number;
  pending_suggestions: number;
  pending_revenue_impact: number;
  applied_last_30d: number;
  parts_out_of_tolerance: number;
}

export interface PricingSummary {
  kpis: PricingKpis;
  active_rules: PricingRule[];
  top_pending_suggestions: PricingSuggestion[];
}

export interface RulePreview {
  rule_id: string;
  parts_in_scope: number;
  parts_out_of_tolerance: number;
  parts_to_increase: number;
  parts_to_decrease: number;
  avg_delta_pct: number | null;
  max_increase_dollars: number | null;
  max_decrease_dollars: number | null;
  total_delta_dollars: number;
  sample: Array<{
    part_number: string;
    current_sell_price: number;
    target_sell_price: number;
    delta_dollars: number;
    delta_pct: number;
    current_margin_pct: number;
    target_margin_pct: number;
  }>;
}

// ── Fetch ──────────────────────────────────────────────────

export async function fetchPricingSummary(): Promise<PricingSummary> {
  const { data, error } = await supabase.rpc("pricing_rules_summary");
  if (error) throw error;
  return data as PricingSummary;
}

export async function fetchActiveRules(): Promise<PricingRule[]> {
  const { data, error } = await supabase
    .from("parts_pricing_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PricingRule[];
}

export async function fetchPendingSuggestions(limit = 100): Promise<PricingSuggestion[]> {
  const { data, error } = await supabase
    .from("parts_pricing_suggestions")
    .select("id, part_number, current_sell, suggested_sell, delta_dollars, delta_pct, current_margin_pct, suggested_margin_pct, reason, signal, created_at")
    .eq("status", "pending")
    .order("delta_dollars", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PricingSuggestion[];
}

export async function previewRule(ruleId: string): Promise<RulePreview> {
  const { data, error } = await supabase.rpc("pricing_rules_preview", { p_rule_id: ruleId });
  if (error) throw error;
  return data as RulePreview;
}

// ── Mutations ──────────────────────────────────────────────

export async function createRule(rule: Omit<PricingRule, "id">): Promise<PricingRule> {
  const { data, error } = await supabase
    .from("parts_pricing_rules")
    .insert(rule)
    .select()
    .single();
  if (error) throw error;
  return data as PricingRule;
}

export async function toggleRule(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("parts_pricing_rules")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw error;
}

export async function regenerateSuggestions(ruleId?: string): Promise<{
  ok: boolean;
  suggestions_written: number;
  batch_id: string;
  elapsed_ms: number;
}> {
  const { data, error } = await supabase.rpc("pricing_suggestions_generate", {
    p_rule_id: ruleId ?? null,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    suggestions_written: number;
    batch_id: string;
    elapsed_ms: number;
  };
}

export async function applySuggestions(ids: string[], note?: string): Promise<{ applied_count: number }> {
  const { data, error } = await supabase.rpc("pricing_suggestions_apply", {
    p_suggestion_ids: ids,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as { applied_count: number };
}

export async function dismissSuggestions(ids: string[], note?: string): Promise<{ dismissed_count: number }> {
  const { data, error } = await supabase.rpc("pricing_suggestions_dismiss", {
    p_suggestion_ids: ids,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as { dismissed_count: number };
}
