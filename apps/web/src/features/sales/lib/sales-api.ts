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
import {
  normalizeCustomerActivityRows,
  normalizeCustomerEquipmentRows,
  normalizeDailyBriefing,
  normalizeDealStageOptions,
  normalizeRepCustomers,
  normalizeRepPipelineDeals,
  type DealStageOption,
} from "./sales-api-normalizers";

export async function fetchTodayBriefing(): Promise<DailyBriefing | null> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("daily_briefings")
    .select("id, briefing_date, briefing_content, created_at")
    .eq("briefing_date", today)
    .maybeSingle();

  if (error) throw error;
  return normalizeDailyBriefing(data);
}

export async function fetchRepPipeline(): Promise<RepPipelineDeal[]> {
  const { data, error } = await supabase
    .from("v_rep_pipeline")
    .select("*")
    .limit(500);

  if (error) throw error;
  return normalizeRepPipelineDeals(data);
}

export async function fetchRepCustomers(): Promise<RepCustomer[]> {
  const { data, error } = await supabase
    .from("v_rep_customers")
    .select("*")
    .limit(100);

  if (error) throw error;
  return normalizeRepCustomers(data);
}


interface CompanyPickerRow {
  id: string;
  name: string | null;
  dba: string | null;
  search_1: string | null;
  search_2: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
}

function mapCompanyPickerRow(row: CompanyPickerRow): RepCustomer {
  return {
    customer_id: row.id,
    company_name: row.name ?? row.dba ?? "Customer",
    search_1: row.search_1 ?? null,
    search_2: row.search_2 ?? null,
    primary_contact_name: null,
    primary_contact_phone: row.phone ?? null,
    primary_contact_email: null,
    city: row.city ?? null,
    state: row.state ?? null,
    open_deals: 0,
    active_quotes: 0,
    last_interaction: null,
    days_since_contact: null,
    opportunity_score: 0,
  };
}

export async function searchCompaniesForPicker(
  rawQuery: string,
  limit = 8,
): Promise<RepCustomer[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const wsId = await getWorkspaceId();
  const { data, error } = await supabase.rpc("search_companies_for_picker_ranked", {
    p_query: query,
    p_workspace_id: wsId,
    p_limit: limit,
  });
  if (error) throw error;
  return ((data ?? []) as CompanyPickerRow[]).map(mapCompanyPickerRow);
}

/**
 * Fallback fetch for customer detail pages when the company isn't in the
 * rep's book (v_rep_customers). Pulls the company row directly from
 * crm_companies plus a best-effort primary contact, and returns a
 * RepCustomer-shaped object so the detail page can render uniformly.
 *
 * The numeric stats (open_deals, active_quotes, opportunity_score,
 * days_since_contact) are zero/null here because they originate in the
 * rep-scoped view; the detail page's equipment / deals / activities /
 * quotes sub-queries hydrate the actual numbers downstream.
 */
export async function fetchCustomerByCompanyId(
  companyId: string,
): Promise<RepCustomer | null> {
  const { data: company, error: companyError } = await supabase
    .from("crm_companies")
    .select("id, name, dba, search_1, search_2, city, state, phone")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) return null;

  const { data: contactRows } = await supabase
    .from("crm_contacts")
    .select("first_name, last_name, email, phone")
    .eq("primary_company_id", companyId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  const contact = contactRows?.[0] ?? null;
  const c = company as {
    id: string;
    name: string | null;
    dba: string | null;
    search_1: string | null;
    search_2: string | null;
    city: string | null;
    state: string | null;
    phone: string | null;
  };
  const contactName = contact
    ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || null
    : null;

  return {
    customer_id: c.id,
    company_name: c.name ?? c.dba ?? "Customer",
    search_1: c.search_1,
    search_2: c.search_2,
    primary_contact_name: contactName,
    primary_contact_phone: contact?.phone ?? c.phone ?? null,
    primary_contact_email: contact?.email ?? null,
    city: c.city,
    state: c.state,
    open_deals: 0,
    active_quotes: 0,
    last_interaction: null,
    days_since_contact: null,
    opportunity_score: 0,
  };
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
  return normalizeCustomerEquipmentRows(data);
}

export async function fetchCustomerDeals(
  companyId: string,
): Promise<RepPipelineDeal[]> {
  const { data, error } = await supabase
    .from("v_rep_pipeline")
    .select("*")
    .eq("company_id", companyId);

  if (error) throw error;
  return normalizeRepPipelineDeals(data);
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
  return normalizeCustomerActivityRows(data);
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
  DealStageOption[]
> {
  const { data, error } = await supabase
    .from("crm_deal_stages")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return normalizeDealStageOptions(data);
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
