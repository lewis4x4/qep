/** Sales Companion API — Supabase queries */
import { supabase } from "@/lib/supabase";

/** Resolve workspace_id from the authenticated user's profile */
async function getWorkspaceId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "default";
  const { data } = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", user.id)
    .maybeSingle();
  return (data as { active_workspace_id: string } | null)?.active_workspace_id ?? "default";
}
import type {
  DailyBriefing,
  RepPipelineDeal,
  RepCustomer,
  CustomerEquipment,
  CustomerActivity,
} from "./types";

export async function fetchTodayBriefing(): Promise<DailyBriefing | null> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("daily_briefings")
    .select("id, briefing_date, briefing_content, created_at")
    .eq("briefing_date", today)
    .maybeSingle();

  if (error) throw error;
  return data as DailyBriefing | null;
}

export async function fetchRepPipeline(): Promise<RepPipelineDeal[]> {
  const { data, error } = await supabase
    .from("v_rep_pipeline")
    .select("*")
    .limit(500);

  if (error) throw error;
  return (data ?? []) as RepPipelineDeal[];
}

export async function fetchRepCustomers(): Promise<RepCustomer[]> {
  const { data, error } = await supabase
    .from("v_rep_customers")
    .select("*")
    .limit(100);

  if (error) throw error;
  return (data ?? []) as RepCustomer[];
}

export async function fetchCustomerEquipment(
  companyId: string,
): Promise<CustomerEquipment[]> {
  const { data, error } = await supabase
    .from("crm_equipment")
    .select("id, make, model, year, serial_number, engine_hours, condition, name")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("engine_hours", { ascending: false, nullsFirst: false });

  if (error) throw error;
  return (data ?? []) as CustomerEquipment[];
}

export async function fetchCustomerDeals(
  companyId: string,
): Promise<RepPipelineDeal[]> {
  const { data, error } = await supabase
    .from("v_rep_pipeline")
    .select("*")
    .eq("company_id", companyId);

  if (error) throw error;
  return (data ?? []) as RepPipelineDeal[];
}

export async function fetchCustomerActivities(
  companyId: string,
  limit = 10,
): Promise<CustomerActivity[]> {
  const { data, error } = await supabase
    .from("crm_activities")
    .select("id, activity_type, body, occurred_at, metadata")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CustomerActivity[];
}

export async function fetchCustomerQuotes(companyId: string) {
  // Quotes are linked via deals assigned to the current rep
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: deals } = await supabase
    .from("crm_deals")
    .select("id")
    .eq("company_id", companyId)
    .eq("assigned_rep_id", user.id)
    .is("deleted_at", null);

  if (!deals?.length) return [];

  const dealIds = deals.map((d: { id: string }) => d.id);
  const { data, error } = await supabase
    .from("quotes")
    .select("id, title, status, created_at, line_items")
    .in("crm_deal_id", dealIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  return data ?? [];
}

export async function fetchDealStages(): Promise<
  Array<{ id: string; name: string; sort_order: number }>
> {
  const { data, error } = await supabase
    .from("crm_deal_stages")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; sort_order: number }>;
}

export async function logVisit(params: {
  companyId: string;
  dealId?: string;
  outcome: string;
  notes?: string;
  nextAction?: string;
}) {
  const wsId = await getWorkspaceId();
  const body = [
    `Visit outcome: ${params.outcome}`,
    params.notes ? `Notes: ${params.notes}` : null,
    params.nextAction ? `Next action: ${params.nextAction}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await supabase.from("crm_activities").insert({
    workspace_id: wsId,
    activity_type: "meeting",
    body,
    occurred_at: new Date().toISOString(),
    company_id: params.companyId,
    deal_id: params.dealId ?? null,
    metadata: {
      source: "sales_companion",
      outcome: params.outcome,
      next_action: params.nextAction,
    },
  });

  if (error) throw error;
}

export async function advanceDealStage(dealId: string, newStageId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("crm_deals")
    .update({ stage_id: newStageId })
    .eq("id", dealId)
    .eq("assigned_rep_id", user.id);

  if (error) throw error;
}

export async function createQuickNote(params: {
  companyId?: string;
  dealId?: string;
  text: string;
}) {
  const wsId = await getWorkspaceId();
  const { error } = await supabase.from("crm_activities").insert({
    workspace_id: wsId,
    activity_type: "note",
    body: params.text,
    occurred_at: new Date().toISOString(),
    company_id: params.companyId ?? null,
    deal_id: params.dealId ?? null,
    metadata: { source: "sales_companion" },
  });

  if (error) throw error;
}
