import { supabase } from "@/lib/supabase";

export interface Asset360Equipment {
  id: string;
  workspace_id: string;
  company_id: string;
  primary_contact_id: string | null;
  name: string;
  asset_tag: string | null;
  serial_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  condition: "new" | "excellent" | "good" | "fair" | "poor" | "salvage" | null;
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned";
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  engine_hours: number | null;
  warranty_expires_on: string | null;
  next_service_due_at: string | null;
  photo_urls: string[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Asset360Company {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
}

export interface Asset360Badges {
  open_work_orders: number;
  open_quotes: number;
  pending_parts_orders: number;
  overdue_intervals: number;
  trade_up_score: number;
  lifetime_parts_spend: number;
}

export interface Asset360RecentService {
  id: string;
  summary: string | null;
  status: string;
  scheduled_for: string | null;
  completed_at: string | null;
}

export interface Asset360OpenDeal {
  id: string;
  name: string;
  amount: number | null;
  stage_id: string | null;
  next_follow_up_at: string | null;
}

export interface Asset360Response {
  equipment: Asset360Equipment;
  company: Asset360Company | null;
  badges: Asset360Badges;
  recent_service: Asset360RecentService[];
  open_deal: Asset360OpenDeal | null;
}

/** Single round-trip composite for the Asset 360 page header + tabs. */
export async function fetchAsset360(equipmentId: string): Promise<Asset360Response | null> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Asset360Response | null; error: unknown }>;
  }).rpc("get_asset_360", { p_equipment_id: equipmentId });
  if (error) throw new Error(String((error as { message?: string }).message ?? "Failed to load Asset 360"));
  return data;
}
