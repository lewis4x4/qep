import { crmSupabase, type CrmDatabase } from "./crm-supabase";
import type {
  CrmActivityCreateInput,
  CrmActivityItem,
  CrmCompanySummary,
  CrmContactTerritory,
  CrmContactSummary,
  CrmPageResult,
} from "./types";

const CONTACTS_PAGE_SIZE = 25;
const COMPANIES_PAGE_SIZE = 25;

type CrmContactRow = CrmDatabase["public"]["Tables"]["crm_contacts"]["Row"];
type CrmCompanyRow = CrmDatabase["public"]["Tables"]["crm_companies"]["Row"];
type CrmActivityRow = CrmDatabase["public"]["Tables"]["crm_activities"]["Row"];

function toContactSummary(row: CrmContactRow): CrmContactSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    dgeCustomerProfileId: row.dge_customer_profile_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    title: row.title,
    primaryCompanyId: row.primary_company_id,
    assignedRepId: row.assigned_rep_id,
    mergedIntoContactId: row.merged_into_contact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCompanySummary(row: CrmCompanyRow): CrmCompanySummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    parentCompanyId: row.parent_company_id,
    assignedRepId: row.assigned_rep_id,
    city: row.city,
    state: row.state,
    country: row.country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActivityItem(row: CrmActivityRow): CrmActivityItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    activityType: row.activity_type,
    body: row.body,
    occurredAt: row.occurred_at,
    contactId: row.contact_id,
    companyId: row.company_id,
    dealId: row.deal_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export {
  getCrmDeal,
  getCrmDealLossFields,
  listCrmDealStages,
  listCrmOpenDealsForBoard,
  listCrmWeightedOpenDeals,
  listRepSafeDealsForContact,
  patchCrmDeal,
} from "./crm-deals-api";

export {
  createCrmQuote,
  listCrmQuotesForContact,
  listCrmQuotesForDeal,
  updateCrmQuote,
} from "./crm-quotes-api";

export async function listCrmContacts(search: string): Promise<CrmPageResult<CrmContactSummary>> {
  const term = search.trim();
  let query = crmSupabase
    .from("crm_contacts")
    .select(
      "id, workspace_id, dge_customer_profile_id, first_name, last_name, email, phone, title, primary_company_id, assigned_rep_id, merged_into_contact_id, created_at, updated_at"
    )
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(CONTACTS_PAGE_SIZE + 1);

  if (term.length > 0) {
    const escaped = term.replace(/[%_]/g, "");
    query = query.or(
      `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CrmContactRow[];
  return {
    items: rows.slice(0, CONTACTS_PAGE_SIZE).map(toContactSummary),
    nextCursor: rows.length > CONTACTS_PAGE_SIZE ? rows[CONTACTS_PAGE_SIZE].id : null,
  };
}

export async function getCrmContact(contactId: string): Promise<CrmContactSummary | null> {
  const { data, error } = await crmSupabase
    .from("crm_contacts")
    .select(
      "id, workspace_id, dge_customer_profile_id, first_name, last_name, email, phone, title, primary_company_id, assigned_rep_id, merged_into_contact_id, created_at, updated_at"
    )
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toContactSummary(data as CrmContactRow) : null;
}

export async function listCrmCompanies(search: string): Promise<CrmPageResult<CrmCompanySummary>> {
  const term = search.trim();
  let query = crmSupabase
    .from("crm_companies")
    .select("id, workspace_id, name, parent_company_id, assigned_rep_id, city, state, country, created_at, updated_at")
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .limit(COMPANIES_PAGE_SIZE + 1);

  if (term.length > 0) {
    const escaped = term.replace(/[%_]/g, "");
    query = query.or(`name.ilike.%${escaped}%,city.ilike.%${escaped}%,state.ilike.%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CrmCompanyRow[];
  return {
    items: rows.slice(0, COMPANIES_PAGE_SIZE).map(toCompanySummary),
    nextCursor: rows.length > COMPANIES_PAGE_SIZE ? rows[COMPANIES_PAGE_SIZE].id : null,
  };
}

export async function getCrmCompany(companyId: string): Promise<CrmCompanySummary | null> {
  const { data, error } = await crmSupabase
    .from("crm_companies")
    .select("id, workspace_id, name, parent_company_id, assigned_rep_id, city, state, country, created_at, updated_at")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toCompanySummary(data as CrmCompanyRow) : null;
}

export async function getProfileDisplayName(profileId: string): Promise<string | null> {
  const { data, error } = await crmSupabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.full_name || data.email || null;
}

export async function listContactActivities(contactId: string): Promise<CrmActivityItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, created_at, updated_at"
    )
    .eq("contact_id", contactId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CrmActivityRow[]).map(toActivityItem);
}

export async function listContactTerritories(contactId: string): Promise<CrmContactTerritory[]> {
  const { data: links, error: linksError } = await crmSupabase
    .from("crm_contact_territories")
    .select("territory_id")
    .eq("contact_id", contactId);

  if (linksError) {
    throw new Error(linksError.message);
  }

  const territoryIds = (links ?? []).map((link) => link.territory_id).filter(Boolean) as string[];
  if (territoryIds.length === 0) {
    return [];
  }

  const { data: territories, error: territoriesError } = await crmSupabase
    .from("crm_territories")
    .select("id, name, assigned_rep_id")
    .in("id", territoryIds)
    .is("deleted_at", null);

  if (territoriesError) {
    throw new Error(territoriesError.message);
  }

  return (territories ?? []).map((territory) => ({
    id: territory.id,
    name: territory.name,
    assignedRepId: territory.assigned_rep_id,
  }));
}

export async function listCompanyActivities(companyId: string): Promise<CrmActivityItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CrmActivityRow[]).map(toActivityItem);
}

export async function listDealActivities(dealId: string): Promise<CrmActivityItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, created_at, updated_at"
    )
    .eq("deal_id", dealId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CrmActivityRow[]).map(toActivityItem);
}

export async function createCrmActivity(
  input: CrmActivityCreateInput,
  actorUserId: string
): Promise<CrmActivityItem> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .insert({
      activity_type: input.activityType,
      body: input.body,
      occurred_at: input.occurredAt,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
      created_by: actorUserId,
    })
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, created_at, updated_at"
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return toActivityItem(data as CrmActivityRow);
}
