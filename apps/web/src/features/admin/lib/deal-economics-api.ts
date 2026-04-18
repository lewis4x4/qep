import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

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
