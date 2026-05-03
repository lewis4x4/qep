/**
 * Post-Sale Parts Playbooks API — Slice 3.6.
 *
 * Typed client over migration 280's RPCs + the post-sale-parts-playbook
 * edge function (Claude Sonnet 4.6).
 */
import { supabase } from "@/lib/supabase";
import {
  normalizeEligibleDeals,
  normalizeGenerationResult,
  normalizePlaybookDetail,
  normalizePlaybookSummary,
  type PlaybookDetail,
} from "./post-sale-api-normalizers";

export interface PlaybookPart {
  part_number: string;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
  on_hand: number;
  probability: number;
  reason: string;
  match_score?: number;
}

export interface PlaybookWindow {
  window: "30d" | "60d" | "90d";
  narrative: string;
  service_description: string;
  parts: PlaybookPart[];
  total_revenue: number;
}

export interface PlaybookPayload {
  windows: PlaybookWindow[];
  grand_total_revenue: number;
  assumptions: Record<string, unknown>;
  generated_at: string;
  machine_profile_id: string | null;
  model_family: string | null;
  customer_name: string | null;
}

export interface PlaybookRow {
  id: string;
  deal_id: string;
  equipment_id: string | null;
  status: "draft" | "reviewed" | "sent" | "accepted" | "dismissed" | "expired";
  total_revenue: number;
  generated_by: string | null;
  created_at: string;
  sent_at: string | null;
  deal_name: string | null;
  company_name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  rep_name: string | null;
}

export interface PlaybookSummary {
  counts: Record<string, number>;
  open_revenue_usd: number;
  recent: PlaybookRow[];
  generated_at: string;
}

export async function fetchPlaybookSummary(): Promise<PlaybookSummary> {
  const { data, error } = await supabase.rpc("post_sale_playbook_summary", {
    p_workspace: null,
    p_limit: 30,
  });
  if (error) throw new Error(`post_sale_playbook_summary: ${error.message}`);
  return normalizePlaybookSummary(data);
}

export interface EligibleDeal {
  deal_id: string;
  company_id: string | null;
  assigned_rep_id: string | null;
  equipment_id: string;
  make: string | null;
  model: string | null;
  closed_at: string;
}

export async function fetchEligibleDeals(limit = 10): Promise<EligibleDeal[]> {
  const { data, error } = await supabase.rpc("eligible_deals_for_playbook", {
    p_workspace: null,
    p_limit: limit,
  });
  if (error) throw new Error(`eligible_deals_for_playbook: ${error.message}`);
  return normalizeEligibleDeals(data);
}

export interface GenerationResult {
  ok: boolean;
  playbook_id?: string;
  status?: string;
  total_revenue?: number;
  window_count?: number;
  parts_count?: number;
  cached?: boolean;
  elapsed_ms?: number;
  error?: string;
}

export async function generatePlaybook(
  dealId: string,
  equipmentId: string,
  refresh = false,
): Promise<GenerationResult> {
  const { data, error } = await supabase.functions.invoke<GenerationResult>(
    "post-sale-parts-playbook",
    { body: { deal_id: dealId, equipment_id: equipmentId, refresh } },
  );
  if (error) throw new Error(`post-sale-parts-playbook: ${error.message}`);
  if (!data) throw new Error("post-sale-parts-playbook: empty response");
  return normalizeGenerationResult(data);
}

export async function generateBatch(limit = 5): Promise<GenerationResult> {
  const { data, error } = await supabase.functions.invoke<GenerationResult>(
    "post-sale-parts-playbook",
    { body: { batch: true, limit } },
  );
  if (error) throw new Error(`post-sale-parts-playbook (batch): ${error.message}`);
  if (!data) throw new Error("post-sale-parts-playbook (batch): empty response");
  return normalizeGenerationResult(data);
}

// Direct fetch of one playbook's full payload (for the detail drawer).
export async function fetchPlaybook(id: string): Promise<PlaybookDetail> {
  const { data, error } = await supabase
    .from("post_sale_parts_playbooks")
    .select("id, status, payload, total_revenue, created_at, sent_at, deal_id, equipment_id")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const normalized = normalizePlaybookDetail(data);
  if (!normalized) throw new Error("post_sale_parts_playbooks: malformed playbook response");
  return normalized;
}

// Transitions: status updates.
export async function updatePlaybookStatus(
  id: string,
  status: PlaybookRow["status"],
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "reviewed") patch.reviewed_at = new Date().toISOString();
  if (status === "sent") patch.sent_at = new Date().toISOString();
  if (status === "accepted") patch.accepted_at = new Date().toISOString();
  const { error } = await supabase
    .from("post_sale_parts_playbooks")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
