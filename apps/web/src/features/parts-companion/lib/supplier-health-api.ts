/**
 * Supplier Health API — Slice 3.5.
 */
import { supabase } from "@/lib/supabase";

export type HealthTier = "green" | "yellow" | "red";

export interface SupplierHealthRow {
  vendor_id: string;
  vendor_name: string;
  supplier_type: string | null;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  profile_fill_rate: number | null;
  price_competitiveness: number | null;
  profile_composite_score: number | null;
  catalog_parts: number;
  parts_compared: number | null;
  parts_up: number | null;
  parts_up_more_than_5pct: number | null;
  price_change_pct_yoy: number | null;
  replenish_items_90d: number | null;
  replenish_items_ordered: number | null;
  fill_rate_pct_90d: number | null;
  avg_approve_to_order_hours: number | null;
  last_price_file_at: string | null;
  days_since_last_price_file: number | null;
  health_tier: HealthTier;
}

export interface SupplierHealthSummary {
  generated_at: string;
  workspace_id: string;
  counts: { green: number; yellow: number; red: number; total: number };
  red_vendors: Array<{
    vendor_id: string;
    vendor_name: string;
    price_change_pct_yoy: number | null;
    fill_rate_pct_90d: number | null;
    days_since_last_price_file: number | null;
    health_tier: HealthTier;
  }>;
  top_price_creep: Array<{
    vendor_id: string;
    vendor_name: string;
    price_change_pct_yoy: number | null;
    parts_up_more_than_5pct: number | null;
    parts_compared: number | null;
  }>;
  lowest_fill_rate: Array<{
    vendor_id: string;
    vendor_name: string;
    fill_rate_pct_90d: number | null;
    replenish_items_90d: number | null;
    replenish_items_ordered: number | null;
  }>;
  rows: SupplierHealthRow[];
}

export async function fetchSupplierHealthSummary(): Promise<SupplierHealthSummary> {
  const { data, error } = await supabase.rpc("supplier_health_summary", {
    p_workspace: null,
  });
  if (error) throw new Error(`supplier_health_summary: ${error.message}`);
  return data as SupplierHealthSummary;
}
