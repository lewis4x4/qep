import { crmSupabase, type QrmDatabase } from "./qrm-supabase";
import {
  createCrmActivityViaRouter,
  deliverCrmActivityViaRouter,
  patchCrmActivityViaRouter,
  patchCrmActivityTaskViaRouter,
} from "./qrm-router-api";
import type {
  QrmActivityCreateInput,
  QrmActivityFeedItem,
  QrmActivityItem,
  QrmActivityPatchInput,
  QrmActivityTaskPatchInput,
  QrmActivityTemplate,
  QrmCompanySummary,
  QrmContactTerritory,
  QrmContactSummary,
  QrmPageResult,
} from "./types";

const CONTACTS_PAGE_SIZE = 25;
const COMPANIES_PAGE_SIZE = 25;
const ACTIVITIES_PAGE_SIZE = 150;

type QrmContactRow = QrmDatabase["public"]["Tables"]["crm_contacts"]["Row"];
type QrmCompanyRow = QrmDatabase["public"]["Tables"]["crm_companies"]["Row"];
type QrmActivityRow = QrmDatabase["public"]["Tables"]["crm_activities"]["Row"];
type QrmActivityTemplateRow = QrmDatabase["public"]["Tables"]["crm_activity_templates"]["Row"];

interface ContactListCursor {
  lastName: string;
  firstName: string;
  id: string;
}

interface CompanyListCursor {
  name: string;
  id: string;
}

function toContactSummary(row: QrmContactRow): QrmContactSummary {
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

function toCompanySummary(row: QrmCompanyRow): QrmCompanySummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    parentCompanyId: row.parent_company_id,
    assignedRepId: row.assigned_rep_id,
    search1: row.search_1,
    search2: row.search_2,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActivityItem(row: QrmActivityRow): QrmActivityItem {
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
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toActivityTemplate(row: QrmActivityTemplateRow): QrmActivityTemplate {
  return {
    id: row.id,
    activityType: row.activity_type,
    label: row.label,
    description: row.description ?? "",
    body: row.body,
    taskDueMinutes: row.task_due_minutes ?? undefined,
    taskStatus: row.task_status ?? undefined,
    sortOrder: row.sort_order,
    source: "workspace",
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listProfileDisplayNames(profileIds: string[]): Promise<Map<string, string>> {
  if (profileIds.length === 0) {
    return new Map();
  }

  const { data, error } = await crmSupabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", profileIds);

  if (error) {
    throw new Error(error.message);
  }

  const output = new Map<string, string>();
  for (const row of data ?? []) {
    output.set(row.id, row.full_name || row.email || "Unknown user");
  }

  return output;
}

async function listContactNames(contactIds: string[]): Promise<Map<string, string>> {
  if (contactIds.length === 0) {
    return new Map();
  }

  const { data, error } = await crmSupabase
    .from("crm_contacts")
    .select("id, first_name, last_name")
    .in("id", contactIds)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  const output = new Map<string, string>();
  for (const row of data ?? []) {
    output.set(row.id, `${row.first_name} ${row.last_name}`.trim());
  }

  return output;
}

async function listCompanyNames(companyIds: string[]): Promise<Map<string, string>> {
  if (companyIds.length === 0) {
    return new Map();
  }

  const { data, error } = await crmSupabase
    .from("crm_companies")
    .select("id, name")
    .in("id", companyIds)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

async function listDealNames(dealIds: string[]): Promise<Map<string, string>> {
  if (dealIds.length === 0) {
    return new Map();
  }

  const { data, error } = await crmSupabase
    .from("crm_deals")
    .select("id, name")
    .in("id", dealIds)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

export {
  getCrmDeal,
  getCrmDealLossFields,
  listCrmDealStages,
  listCrmOpenDealsForBoard,
  listCrmWeightedOpenDeals,
  listRepSafeDealsForContact,
  patchCrmDeal,
  reorderPipelineDeals,
} from "./qrm-deals-api";

export {
  createCrmQuote,
  listCrmQuotesForContact,
  listCrmQuotesForDeal,
  updateCrmQuote,
} from "./qrm-quotes-api";

function encodeCursor(value: ContactListCursor | CompanyListCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeCursor<T>(cursor: string | null | undefined): T | null {
  if (!cursor) return null;
  try {
    const binary = atob(cursor);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error("Invalid list cursor.");
  }
}

export async function listCrmContacts(
  search: string,
  cursor?: string | null,
  options?: { treeRootCompanyId?: string },
): Promise<QrmPageResult<QrmContactSummary>> {
  const decodedCursor = decodeCursor<ContactListCursor>(cursor);
  const treeRoot = options?.treeRootCompanyId?.trim();

  const rpcClient = crmSupabase as typeof crmSupabase & {
    rpc: (
      fn: "list_crm_contacts_page" | "list_crm_contacts_for_company_subtree_page",
      args: Record<string, string | number | null>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };

  const { data, error } = treeRoot
    ? await rpcClient.rpc("list_crm_contacts_for_company_subtree_page", {
        p_company_id: treeRoot,
        p_search: search.trim() || null,
        p_after_last_name: decodedCursor?.lastName ?? null,
        p_after_first_name: decodedCursor?.firstName ?? null,
        p_after_id: decodedCursor?.id ?? null,
        p_limit: CONTACTS_PAGE_SIZE + 1,
      })
    : await rpcClient.rpc("list_crm_contacts_page", {
        p_search: search.trim() || null,
        p_after_last_name: decodedCursor?.lastName ?? null,
        p_after_first_name: decodedCursor?.firstName ?? null,
        p_after_id: decodedCursor?.id ?? null,
        p_limit: CONTACTS_PAGE_SIZE + 1,
      });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as QrmContactRow[];
  const visibleRows = rows.slice(0, CONTACTS_PAGE_SIZE);
  const nextRow = rows.length > CONTACTS_PAGE_SIZE ? visibleRows[visibleRows.length - 1] : null;
  return {
    items: visibleRows.map(toContactSummary),
    nextCursor: nextRow
      ? encodeCursor({
          lastName: nextRow.last_name,
          firstName: nextRow.first_name,
          id: nextRow.id,
        })
      : null,
  };
}

export async function getCrmContact(contactId: string): Promise<QrmContactSummary | null> {
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

  return data ? toContactSummary(data as QrmContactRow) : null;
}

export async function listCrmCompanies(search: string, cursor?: string | null): Promise<QrmPageResult<QrmCompanySummary>> {
  const decodedCursor = decodeCursor<CompanyListCursor>(cursor);
  const { data, error } = await (crmSupabase as typeof crmSupabase & {
    rpc: (
      fn: "list_crm_companies_page",
      args: {
        p_search: string | null;
        p_after_name: string | null;
        p_after_id: string | null;
        p_limit: number;
      },
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  }).rpc("list_crm_companies_page", {
    p_search: search.trim() || null,
    p_after_name: decodedCursor?.name ?? null,
    p_after_id: decodedCursor?.id ?? null,
    p_limit: COMPANIES_PAGE_SIZE + 1,
  });
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as QrmCompanyRow[];
  const visibleRows = rows.slice(0, COMPANIES_PAGE_SIZE);
  const nextRow = rows.length > COMPANIES_PAGE_SIZE ? visibleRows[visibleRows.length - 1] : null;
  return {
    items: visibleRows.map(toCompanySummary),
    nextCursor: nextRow
      ? encodeCursor({
          name: nextRow.name,
          id: nextRow.id,
        })
      : null,
  };
}

export async function getCrmCompany(companyId: string): Promise<QrmCompanySummary | null> {
  const { data, error } = await crmSupabase
    .from("crm_companies")
    .select("id, workspace_id, name, parent_company_id, assigned_rep_id, search_1, search_2, address_line_1, address_line_2, city, state, postal_code, country, created_at, updated_at")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toCompanySummary(data as QrmCompanyRow) : null;
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

export async function listContactActivities(contactId: string): Promise<QrmActivityItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at"
    )
    .eq("contact_id", contactId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmActivityRow[]).map(toActivityItem);
}

export async function listContactTerritories(contactId: string): Promise<QrmContactTerritory[]> {
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

export async function listCompanyActivities(companyId: string): Promise<QrmActivityItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmActivityRow[]).map(toActivityItem);
}

export async function listDealActivities(dealId: string): Promise<QrmActivityItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at"
    )
    .eq("deal_id", dealId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmActivityRow[]).map(toActivityItem);
}

export async function listCrmActivityFeed(): Promise<QrmActivityFeedItem[]> {
  const { data, error } = await crmSupabase
    .from("crm_activities")
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at"
    )
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(ACTIVITIES_PAGE_SIZE);

  if (error) {
    throw new Error(error.message);
  }

  const items = ((data ?? []) as QrmActivityRow[]).map(toActivityItem);
  const createdByIds = Array.from(new Set(items.map((item) => item.createdBy).filter(Boolean))) as string[];
  const contactIds = Array.from(new Set(items.map((item) => item.contactId).filter(Boolean))) as string[];
  const companyIds = Array.from(new Set(items.map((item) => item.companyId).filter(Boolean))) as string[];
  const dealIds = Array.from(new Set(items.map((item) => item.dealId).filter(Boolean))) as string[];

  const [actorNames, contactNames, companyNames, dealNames] = await Promise.all([
    listProfileDisplayNames(createdByIds),
    listContactNames(contactIds),
    listCompanyNames(companyIds),
    listDealNames(dealIds),
  ]);

  return items.map((item) => ({
    ...item,
    actorName: item.createdBy ? actorNames.get(item.createdBy) ?? null : null,
    contactName: item.contactId ? contactNames.get(item.contactId) ?? null : null,
    companyName: item.companyId ? companyNames.get(item.companyId) ?? null : null,
    dealName: item.dealId ? dealNames.get(item.dealId) ?? null : null,
  }));
}

export async function listCrmActivityTemplates(): Promise<QrmActivityTemplate[]> {
  const { data, error } = await crmSupabase
    .from("crm_activity_templates")
    .select(
      "id, workspace_id, activity_type, label, description, body, task_due_minutes, task_status, sort_order, is_active, created_by, created_at, updated_at, deleted_at"
    )
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("activity_type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmActivityTemplateRow[]).map(toActivityTemplate);
}

export async function listManageableCrmActivityTemplates(): Promise<QrmActivityTemplate[]> {
  const { data, error } = await crmSupabase
    .from("crm_activity_templates")
    .select(
      "id, workspace_id, activity_type, label, description, body, task_due_minutes, task_status, sort_order, is_active, created_by, created_at, updated_at, deleted_at"
    )
    .is("deleted_at", null)
    .order("activity_type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmActivityTemplateRow[]).map(toActivityTemplate);
}

export async function createCrmActivityTemplate(input: {
  activityType: QrmActivityTemplate["activityType"];
  label: string;
  description: string;
  body: string;
  taskDueMinutes?: number | null;
  taskStatus?: QrmActivityTemplate["taskStatus"];
  sortOrder?: number;
  createdBy: string;
}): Promise<QrmActivityTemplate> {
  const { data, error } = await crmSupabase
    .from("crm_activity_templates")
    .insert({
      activity_type: input.activityType,
      label: input.label,
      description: input.description || null,
      body: input.body,
      task_due_minutes: input.taskDueMinutes ?? null,
      task_status: input.taskStatus ?? null,
      sort_order: input.sortOrder ?? 0,
      created_by: input.createdBy,
      is_active: true,
    })
    .select(
      "id, workspace_id, activity_type, label, description, body, task_due_minutes, task_status, sort_order, is_active, created_by, created_at, updated_at, deleted_at"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create QRM activity template.");
  }

  return toActivityTemplate(data as QrmActivityTemplateRow);
}

export async function updateCrmActivityTemplate(
  templateId: string,
  input: {
    activityType: QrmActivityTemplate["activityType"];
    label: string;
    description: string;
    body: string;
    taskDueMinutes?: number | null;
    taskStatus?: QrmActivityTemplate["taskStatus"];
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<QrmActivityTemplate> {
  const { data, error } = await crmSupabase
    .from("crm_activity_templates")
    .update({
      activity_type: input.activityType,
      label: input.label,
      description: input.description || null,
      body: input.body,
      task_due_minutes: input.taskDueMinutes ?? null,
      task_status: input.taskStatus ?? null,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    })
    .eq("id", templateId)
    .select(
      "id, workspace_id, activity_type, label, description, body, task_due_minutes, task_status, sort_order, is_active, created_by, created_at, updated_at, deleted_at"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update QRM activity template.");
  }

  return toActivityTemplate(data as QrmActivityTemplateRow);
}

export async function archiveCrmActivityTemplate(templateId: string): Promise<void> {
  const { error } = await crmSupabase
    .from("crm_activity_templates")
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", templateId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createCrmActivity(
  input: QrmActivityCreateInput,
  _actorUserId: string
): Promise<QrmActivityItem> {
  return createCrmActivityViaRouter(input);
}

export async function patchCrmActivityTask(
  activityId: string,
  input: QrmActivityTaskPatchInput,
): Promise<QrmActivityItem> {
  return patchCrmActivityTaskViaRouter(activityId, input);
}

export async function patchCrmActivity(
  activityId: string,
  input: QrmActivityPatchInput,
): Promise<QrmActivityItem> {
  return patchCrmActivityViaRouter(activityId, input);
}

export async function archiveCrmActivity(
  activityId: string,
  updatedAt?: string,
): Promise<QrmActivityItem> {
  return patchCrmActivityViaRouter(activityId, {
    archive: true,
    updatedAt,
  });
}

export async function deliverCrmActivity(
  activityId: string,
  updatedAt?: string,
): Promise<QrmActivityItem> {
  return deliverCrmActivityViaRouter(activityId, updatedAt);
}
