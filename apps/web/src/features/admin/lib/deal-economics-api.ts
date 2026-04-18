import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

// ── Service credits ──────────────────────────────────────────────────────────

export type ServiceCreditRow =
  Database["public"]["Tables"]["qb_service_credit_config"]["Row"];
export type ServiceCreditInput =
  Database["public"]["Tables"]["qb_service_credit_config"]["Insert"];

const DEFAULTS: ServiceCreditRow[] = [
  { workspace_id: "default", category: "compact",  credit_cents: 150000, travel_budget_cents: 20000, updated_at: new Date().toISOString() },
  { workspace_id: "default", category: "large",    credit_cents: 250000, travel_budget_cents: 20000, updated_at: new Date().toISOString() },
  { workspace_id: "default", category: "forestry", credit_cents: 350000, travel_budget_cents: 20000, updated_at: new Date().toISOString() },
];

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export async function getServiceCredits(): Promise<ServiceCreditRow[]> {
  const { data, error } = await supabase
    .from("qb_service_credit_config")
    .select("*")
    .order("category");

  if (error || !data || data.length === 0) {
    return DEFAULTS;
  }
  return data;
}

export async function upsertServiceCredits(
  rows: ServiceCreditInput[]
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_service_credit_config")
    .upsert(rows);

  if (error) return { error: error.message };
  return { ok: true };
}

// ── Internal freight rules ───────────────────────────────────────────────────

export type FreightRuleRow =
  Database["public"]["Tables"]["qb_internal_freight_rules"]["Row"];
export type FreightRuleInput =
  Database["public"]["Tables"]["qb_internal_freight_rules"]["Insert"];

export async function getFreightRules(): Promise<FreightRuleRow[]> {
  const { data, error } = await supabase
    .from("qb_internal_freight_rules")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return [];
  return data ?? [];
}

export async function createFreightRule(
  input: FreightRuleInput
): Promise<{ ok: true; id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("qb_internal_freight_rules")
    .insert(input)
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { ok: true, id: data.id };
}

export async function updateFreightRule(
  id: string,
  input: FreightRuleInput
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_internal_freight_rules")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteFreightRule(
  id: string
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_internal_freight_rules")
    .delete()
    .eq("id", id);

  if (error) return { error: error.message };
  return { ok: true };
}

// ── Brand freight keys ───────────────────────────────────────────────────────

export interface BrandFreightKeyRow {
  id: string;
  code: string;
  name: string;
  has_inbound_freight_key: boolean;
}

export async function getBrandFreightKeys(): Promise<BrandFreightKeyRow[]> {
  const { data, error } = await supabase
    .from("qb_brands")
    .select("id, code, name, has_inbound_freight_key")
    .order("name", { ascending: true });

  if (error) return [];
  return (data ?? []) as BrandFreightKeyRow[];
}

export async function setBrandFreightKey(
  brandId: string,
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_brands")
    .update({ has_inbound_freight_key: enabled })
    .eq("id", brandId);

  if (error) return { error: error.message };
  return { ok: true };
}
