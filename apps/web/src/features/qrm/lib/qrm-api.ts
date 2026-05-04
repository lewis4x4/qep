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

type ListCrmContactRow =
  | QrmDatabase["public"]["Functions"]["list_crm_contacts_page"]["Returns"][number]
  | QrmDatabase["public"]["Functions"]["list_crm_contacts_for_company_subtree_page"]["Returns"][number];
type ListCrmCompanyRow = QrmDatabase["public"]["Functions"]["list_crm_companies_page"]["Returns"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function metadataTextValue(metadata: unknown, key: string): string | null {
  const value = recordValue(metadata)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeActivityType(value: unknown): QrmActivityItem["activityType"] {
  return value === "note" || value === "call" || value === "email" || value === "meeting" || value === "task" || value === "sms"
    ? value
    : "note";
}

function normalizeTaskStatus(value: unknown): QrmActivityTemplate["taskStatus"] | undefined {
  return value === "open" || value === "completed" ? value : undefined;
}

function normalizeProductCategory(value: unknown): QrmCompanySummary["productCategory"] {
  return value === "business" || value === "individual" || value === "government" || value === "non_profit" || value === "internal"
    ? value
    : null;
}

function normalizeArType(value: unknown): QrmCompanySummary["arType"] {
  return value === "open_item" || value === "balance_forward" || value === "true_balance_forward" ? value : null;
}

interface ContactListCursor {
  lastName: string;
  firstName: string;
  id: string;
}

interface CompanyListCursor {
  name: string;
  id: string;
}

export function parseEncodedQrmCursor(cursor: string): unknown {
  try {
    const binary = atob(cursor);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Invalid list cursor.");
  }
}

function normalizeContactListCursor(value: unknown): ContactListCursor | null {
  if (!isRecord(value)) return null;
  return typeof value.lastName === "string" && typeof value.firstName === "string" && typeof value.id === "string"
    ? { lastName: value.lastName, firstName: value.firstName, id: value.id }
    : null;
}

function normalizeCompanyListCursor(value: unknown): CompanyListCursor | null {
  if (!isRecord(value)) return null;
  return typeof value.name === "string" && typeof value.id === "string"
    ? { name: value.name, id: value.id }
    : null;
}

function toListContactSummary(row: ListCrmContactRow): QrmContactSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    dgeCustomerProfileId: row.dge_customer_profile_id ?? null,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    cell: null,
    directPhone: null,
    birthDate: null,
    smsOptIn: null,
    title: row.title ?? null,
    primaryCompanyId: row.primary_company_id ?? null,
    assignedRepId: row.assigned_rep_id ?? null,
    mergedIntoContactId: row.merged_into_contact_id ?? null,
    sourceCustomerNumber: null,
    sourceContactNumber: null,
    sourceStatusCode: null,
    sourceSalespersonCode: null,
    myDealerUser: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toListCompanySummary(row: ListCrmCompanyRow): QrmCompanySummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    parentCompanyId: row.parent_company_id ?? null,
    assignedRepId: row.assigned_rep_id ?? null,
    legacyCustomerNumber: row.legacy_customer_number ?? null,
    status: null,
    productCategory: null,
    arType: null,
    paymentTermsCode: null,
    termsCode: null,
    territoryCode: null,
    pricingLevel: null,
    doNotContact: null,
    optOutSalePi: null,
    search1: row.search_1 ?? null,
    search2: row.search_2 ?? null,
    addressLine1: row.address_line_1 ?? null,
    addressLine2: row.address_line_2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeContactRows(rows: unknown): QrmContactSummary[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      workspaceId: requiredString(row.workspace_id, "default"),
      dgeCustomerProfileId: nullableString(row.dge_customer_profile_id),
      firstName: requiredString(row.first_name),
      lastName: requiredString(row.last_name),
      email: nullableString(row.email),
      phone: nullableString(row.phone),
      cell: nullableString(row.cell),
      directPhone: nullableString(row.direct_phone),
      birthDate: nullableString(row.birth_date),
      smsOptIn: nullableBoolean(row.sms_opt_in),
      title: nullableString(row.title),
      primaryCompanyId: nullableString(row.primary_company_id),
      assignedRepId: nullableString(row.assigned_rep_id),
      mergedIntoContactId: nullableString(row.merged_into_contact_id),
      sourceCustomerNumber: metadataTextValue(row.metadata, "source_customer_number"),
      sourceContactNumber: metadataTextValue(row.metadata, "source_contact_number"),
      sourceStatusCode: metadataTextValue(row.metadata, "status_code"),
      sourceSalespersonCode: metadataTextValue(row.metadata, "salesperson_code"),
      myDealerUser: metadataTextValue(row.metadata, "mydealer_user"),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    }];
  });
}

export function normalizeCompanyRows(rows: unknown): QrmCompanySummary[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      workspaceId: requiredString(row.workspace_id, "default"),
      name: requiredString(row.name, "Unnamed company"),
      parentCompanyId: nullableString(row.parent_company_id),
      assignedRepId: nullableString(row.assigned_rep_id),
      legacyCustomerNumber: nullableString(row.legacy_customer_number),
      status: nullableString(row.status),
      productCategory: normalizeProductCategory(row.product_category),
      arType: normalizeArType(row.ar_type),
      paymentTermsCode: nullableString(row.payment_terms_code),
      termsCode: nullableString(row.terms_code),
      territoryCode: nullableString(row.territory_code),
      pricingLevel: nullableNumber(row.pricing_level),
      doNotContact: nullableBoolean(row.do_not_contact),
      optOutSalePi: nullableBoolean(row.opt_out_sale_pi),
      search1: nullableString(row.search_1),
      search2: nullableString(row.search_2),
      addressLine1: nullableString(row.address_line_1),
      addressLine2: nullableString(row.address_line_2),
      city: nullableString(row.city),
      state: nullableString(row.state),
      postalCode: nullableString(row.postal_code),
      country: nullableString(row.country),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    }];
  });
}

export function normalizeActivityRows(rows: unknown): QrmActivityItem[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      workspaceId: requiredString(row.workspace_id, "default"),
      activityType: normalizeActivityType(row.activity_type),
      body: nullableString(row.body),
      occurredAt: requiredString(row.occurred_at),
      contactId: nullableString(row.contact_id),
      companyId: nullableString(row.company_id),
      dealId: nullableString(row.deal_id),
      createdBy: nullableString(row.created_by),
      metadata: recordValue(row.metadata),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    }];
  });
}

export function normalizeActivityTemplateRows(rows: unknown): QrmActivityTemplate[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      activityType: normalizeActivityType(row.activity_type),
      label: requiredString(row.label, "Untitled template"),
      description: nullableString(row.description) ?? "",
      body: requiredString(row.body),
      taskDueMinutes: nullableNumber(row.task_due_minutes) ?? undefined,
      taskStatus: normalizeTaskStatus(row.task_status),
      sortOrder: nullableNumber(row.sort_order) ?? 0,
      source: "workspace",
      isActive: nullableBoolean(row.is_active) ?? false,
      createdAt: nullableString(row.created_at) ?? undefined,
      updatedAt: nullableString(row.updated_at) ?? undefined,
    }];
  });
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

function decodeContactCursor(cursor: string | null | undefined): ContactListCursor | null {
  if (!cursor) return null;
  const parsed = parseEncodedQrmCursor(cursor);
  const normalized = normalizeContactListCursor(parsed);
  if (!normalized) {
    throw new Error("Invalid list cursor.");
  }
  return normalized;
}

function decodeCompanyCursor(cursor: string | null | undefined): CompanyListCursor | null {
  if (!cursor) return null;
  const parsed = parseEncodedQrmCursor(cursor);
  const normalized = normalizeCompanyListCursor(parsed);
  if (!normalized) {
    throw new Error("Invalid list cursor.");
  }
  return normalized;
}

export async function listCrmContacts(
  search: string,
  cursor?: string | null,
  options?: { treeRootCompanyId?: string },
): Promise<QrmPageResult<QrmContactSummary>> {
  const decodedCursor = decodeContactCursor(cursor);
  const treeRoot = options?.treeRootCompanyId?.trim();
  const normalizedSearch = search.trim() || undefined;

  const { data, error } = treeRoot
    ? await crmSupabase.rpc("list_crm_contacts_for_company_subtree_page", {
        p_company_id: treeRoot,
        p_search: normalizedSearch,
        p_after_last_name: decodedCursor?.lastName,
        p_after_first_name: decodedCursor?.firstName,
        p_after_id: decodedCursor?.id,
        p_limit: CONTACTS_PAGE_SIZE + 1,
      })
    : await crmSupabase.rpc("list_crm_contacts_page", {
        p_search: normalizedSearch,
        p_after_last_name: decodedCursor?.lastName,
        p_after_first_name: decodedCursor?.firstName,
        p_after_id: decodedCursor?.id,
        p_limit: CONTACTS_PAGE_SIZE + 1,
      });

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const visibleRows = rows.slice(0, CONTACTS_PAGE_SIZE);
  const nextRow = rows.length > CONTACTS_PAGE_SIZE ? visibleRows[visibleRows.length - 1] : null;
  return {
    items: visibleRows.map(toListContactSummary),
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
      "id, workspace_id, dge_customer_profile_id, first_name, last_name, email, phone, cell, direct_phone, birth_date, sms_opt_in, title, primary_company_id, assigned_rep_id, merged_into_contact_id, metadata, created_at, updated_at"
    )
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeContactRows(data ? [data] : [])[0] ?? null;
}

export async function listCrmContactsByIds(contactIds: string[]): Promise<QrmContactSummary[]> {
  const ids = Array.from(new Set(contactIds.map((id) => id.trim()).filter((id) => id.length > 0)));
  if (ids.length === 0) return [];

  const { data, error } = await crmSupabase
    .from("crm_contacts")
    .select(
      "id, workspace_id, dge_customer_profile_id, first_name, last_name, email, phone, cell, direct_phone, birth_date, sms_opt_in, title, primary_company_id, assigned_rep_id, merged_into_contact_id, metadata, created_at, updated_at"
    )
    .in("id", ids)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return normalizeContactRows(data);
}

export async function listCrmCompanies(
  search: string,
  cursor?: string | null,
  options?: { includeExtendedFields?: boolean },
): Promise<QrmPageResult<QrmCompanySummary>> {
  const decodedCursor = decodeCompanyCursor(cursor);
  const { data, error } = await crmSupabase.rpc("list_crm_companies_page", {
    p_search: search.trim() || undefined,
    p_after_name: decodedCursor?.name,
    p_after_id: decodedCursor?.id,
    p_include_extended_fields: options?.includeExtendedFields ?? false,
    p_limit: COMPANIES_PAGE_SIZE + 1,
  });
  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const visibleRows = rows.slice(0, COMPANIES_PAGE_SIZE);
  const nextRow = rows.length > COMPANIES_PAGE_SIZE ? visibleRows[visibleRows.length - 1] : null;
  return {
    items: visibleRows.map(toListCompanySummary),
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
    .select("id, workspace_id, name, parent_company_id, assigned_rep_id, legacy_customer_number, status, product_category, ar_type, payment_terms_code, terms_code, territory_code, pricing_level, do_not_contact, opt_out_sale_pi, search_1, search_2, address_line_1, address_line_2, city, state, postal_code, country, created_at, updated_at")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeCompanyRows(data ? [data] : [])[0] ?? null;
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

  return normalizeActivityRows(data);
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

  return normalizeActivityRows(data);
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

  return normalizeActivityRows(data);
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

  const items = normalizeActivityRows(data);
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

  return normalizeActivityTemplateRows(data);
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

  return normalizeActivityTemplateRows(data);
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

  const template = normalizeActivityTemplateRows([data])[0];
  if (!template) {
    throw new Error("QRM activity template response was malformed.");
  }
  return template;
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

  const template = normalizeActivityTemplateRows([data])[0];
  if (!template) {
    throw new Error("QRM activity template response was malformed.");
  }
  return template;
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
