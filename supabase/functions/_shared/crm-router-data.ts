import type { RouterCtx } from "./crm-router-service.ts";

export type CustomRecordType = "contact" | "company" | "equipment";

export interface EquipmentPayload {
  companyId: string;
  name: string;
  assetTag?: string | null;
  serialNumber?: string | null;
  primaryContactId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CustomFieldDefinitionPayload {
  objectType: CustomRecordType;
  key: string;
  label: string;
  dataType: string;
  required?: boolean;
  visibilityRoles?: string[];
  sortOrder?: number;
  constraints?: Record<string, unknown>;
}

export interface ActivityPayload {
  activityType: "note" | "call" | "email" | "meeting" | "task" | "sms";
  body?: string | null;
  occurredAt: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function isValidCustomValue(dataType: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;

  switch (dataType) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "json":
      return true;
    default:
      return false;
  }
}

async function ensureRecordVisible(
  ctx: RouterCtx,
  recordType: CustomRecordType,
  recordId: string,
): Promise<void> {
  const table = recordType === "contact"
    ? "crm_contacts"
    : recordType === "company"
    ? "crm_companies"
    : "crm_equipment";

  const { data, error } = await ctx.callerDb
    .from(table)
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", recordId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
}

async function ensureDealVisible(
  ctx: RouterCtx,
  dealId: string,
): Promise<void> {
  const { data, error } = await ctx.callerDb
    .from("crm_deals")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
}

export async function listEquipment(
  ctx: RouterCtx,
  companyId: string | null,
): Promise<unknown[]> {
  let query = ctx.callerDb
    .from("crm_equipment")
    .select("id, company_id, primary_contact_id, name, asset_tag, serial_number, metadata, created_at, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    primaryContactId: row.primary_contact_id,
    name: row.name,
    assetTag: row.asset_tag,
    serialNumber: row.serial_number,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createActivity(
  ctx: RouterCtx,
  payload: ActivityPayload,
): Promise<unknown> {
  const occurredAtMs = Date.parse(payload.occurredAt);
  if (Number.isNaN(occurredAtMs)) {
    throw new Error("VALIDATION_INVALID_OCCURRED_AT");
  }
  const occurredAtIso = new Date(occurredAtMs).toISOString();

  const activityType = payload.activityType;
  if (!["note", "call", "email", "meeting", "task", "sms"].includes(activityType)) {
    throw new Error("VALIDATION_INVALID_ACTIVITY_TYPE");
  }

  const contactId = cleanText(payload.contactId ?? null);
  const companyId = cleanText(payload.companyId ?? null);
  const dealId = cleanText(payload.dealId ?? null);
  if (!contactId && !companyId && !dealId) {
    throw new Error("VALIDATION_ACTIVITY_TARGET_REQUIRED");
  }

  if (contactId) {
    await ensureRecordVisible(ctx, "contact", contactId);
  }
  if (companyId) {
    await ensureRecordVisible(ctx, "company", companyId);
  }
  if (dealId) {
    await ensureDealVisible(ctx, dealId);
  }

  const { data, error } = await ctx.callerDb
    .from("crm_activities")
    .insert({
      workspace_id: ctx.workspaceId,
      activity_type: activityType,
      body: cleanText(payload.body ?? null),
      occurred_at: occurredAtIso,
      contact_id: contactId,
      company_id: companyId,
      deal_id: dealId,
      created_by: ctx.caller.userId,
    })
    .select("id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, created_at, updated_at")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    activityType: data.activity_type,
    body: data.body,
    occurredAt: data.occurred_at,
    contactId: data.contact_id,
    companyId: data.company_id,
    dealId: data.deal_id,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function createEquipment(
  ctx: RouterCtx,
  payload: EquipmentPayload,
): Promise<unknown> {
  const name = cleanText(payload.name);
  if (!name) throw new Error("VALIDATION_NAME_REQUIRED");

  const insertPayload = {
    workspace_id: ctx.workspaceId,
    company_id: payload.companyId,
    primary_contact_id: payload.primaryContactId ?? null,
    name,
    asset_tag: cleanText(payload.assetTag ?? null),
    serial_number: cleanText(payload.serialNumber ?? null),
    metadata: payload.metadata ?? {},
  };

  const { data, error } = await ctx.callerDb
    .from("crm_equipment")
    .insert(insertPayload)
    .select("id, company_id, primary_contact_id, name, asset_tag, serial_number, metadata, created_at, updated_at")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    companyId: data.company_id,
    primaryContactId: data.primary_contact_id,
    name: data.name,
    assetTag: data.asset_tag,
    serialNumber: data.serial_number,
    metadata: data.metadata ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function patchEquipment(
  ctx: RouterCtx,
  equipmentId: string,
  payload: Partial<EquipmentPayload>,
): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  if (payload.companyId !== undefined) updates.company_id = payload.companyId;
  if (payload.primaryContactId !== undefined) {
    updates.primary_contact_id = payload.primaryContactId;
  }
  if (payload.name !== undefined) {
    const cleaned = cleanText(payload.name);
    if (!cleaned) throw new Error("VALIDATION_NAME_REQUIRED");
    updates.name = cleaned;
  }
  if (payload.assetTag !== undefined) updates.asset_tag = cleanText(payload.assetTag ?? null);
  if (payload.serialNumber !== undefined) {
    updates.serial_number = cleanText(payload.serialNumber ?? null);
  }
  if (payload.metadata !== undefined) updates.metadata = payload.metadata ?? {};

  if (Object.keys(updates).length === 0) throw new Error("VALIDATION_EMPTY_PATCH");

  const { data, error } = await ctx.callerDb
    .from("crm_equipment")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", equipmentId)
    .is("deleted_at", null)
    .select("id, company_id, primary_contact_id, name, asset_tag, serial_number, metadata, created_at, updated_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");

  return {
    id: data.id,
    companyId: data.company_id,
    primaryContactId: data.primary_contact_id,
    name: data.name,
    assetTag: data.asset_tag,
    serialNumber: data.serial_number,
    metadata: data.metadata ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function patchCompanyParent(
  ctx: RouterCtx,
  companyId: string,
  parentCompanyId: string | null,
): Promise<unknown> {
  if (parentCompanyId === companyId) {
    throw new Error("HIERARCHY_CYCLE");
  }

  if (parentCompanyId) {
    const { data: parentRow, error: parentError } = await ctx.callerDb
      .from("crm_companies")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", parentCompanyId)
      .is("deleted_at", null)
      .maybeSingle();

    if (parentError) throw parentError;
    if (!parentRow) throw new Error("NOT_FOUND");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_companies")
    .update({ parent_company_id: parentCompanyId })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", companyId)
    .is("deleted_at", null)
    .select("id, parent_company_id, updated_at")
    .maybeSingle();

  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("company hierarchy cycle detected")) {
      throw new Error("HIERARCHY_CYCLE");
    }
    throw error;
  }
  if (!data) throw new Error("NOT_FOUND");

  return {
    id: data.id,
    parentCompanyId: data.parent_company_id,
    updatedAt: data.updated_at,
  };
}

export async function listCustomFieldDefinitions(
  ctx: RouterCtx,
  objectType: CustomRecordType | null,
): Promise<unknown[]> {
  let query = ctx.callerDb
    .from("crm_custom_field_definitions")
    .select("id, object_type, key, label, data_type, required, visibility_roles, sort_order, constraints, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .limit(300);

  if (objectType) {
    query = query.eq("object_type", objectType);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    objectType: row.object_type,
    key: row.key,
    label: row.label,
    dataType: row.data_type,
    required: row.required,
    visibilityRoles: row.visibility_roles ?? [],
    sortOrder: row.sort_order,
    constraints: row.constraints ?? {},
    updatedAt: row.updated_at,
  }));
}

export async function createCustomFieldDefinition(
  ctx: RouterCtx,
  payload: CustomFieldDefinitionPayload,
): Promise<unknown> {
  const key = normalizeKey(payload.key);
  const label = cleanText(payload.label);
  if (!key || !label) throw new Error("VALIDATION_INVALID_CUSTOM_FIELD");

  const { data, error } = await ctx.callerDb
    .from("crm_custom_field_definitions")
    .insert({
      workspace_id: ctx.workspaceId,
      object_type: payload.objectType,
      key,
      label,
      data_type: payload.dataType,
      required: Boolean(payload.required),
      visibility_roles: payload.visibilityRoles ?? [],
      sort_order: payload.sortOrder ?? 0,
      constraints: payload.constraints ?? {},
    })
    .select("id, object_type, key, label, data_type, required, visibility_roles, sort_order, constraints, updated_at")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    objectType: data.object_type,
    key: data.key,
    label: data.label,
    dataType: data.data_type,
    required: data.required,
    visibilityRoles: data.visibility_roles ?? [],
    sortOrder: data.sort_order,
    constraints: data.constraints ?? {},
    updatedAt: data.updated_at,
  };
}

export async function patchCustomFieldDefinition(
  ctx: RouterCtx,
  definitionId: string,
  payload: Partial<CustomFieldDefinitionPayload>,
): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  if (payload.label !== undefined) {
    const label = cleanText(payload.label);
    if (!label) throw new Error("VALIDATION_INVALID_CUSTOM_FIELD");
    updates.label = label;
  }
  if (payload.required !== undefined) updates.required = Boolean(payload.required);
  if (payload.visibilityRoles !== undefined) updates.visibility_roles = payload.visibilityRoles;
  if (payload.sortOrder !== undefined) updates.sort_order = payload.sortOrder;
  if (payload.constraints !== undefined) updates.constraints = payload.constraints ?? {};
  if (payload.dataType !== undefined) updates.data_type = payload.dataType;

  if (Object.keys(updates).length === 0) throw new Error("VALIDATION_EMPTY_PATCH");

  const { data, error } = await ctx.callerDb
    .from("crm_custom_field_definitions")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", definitionId)
    .is("deleted_at", null)
    .select("id, object_type, key, label, data_type, required, visibility_roles, sort_order, constraints, updated_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");

  return {
    id: data.id,
    objectType: data.object_type,
    key: data.key,
    label: data.label,
    dataType: data.data_type,
    required: data.required,
    visibilityRoles: data.visibility_roles ?? [],
    sortOrder: data.sort_order,
    constraints: data.constraints ?? {},
    updatedAt: data.updated_at,
  };
}

export async function getRecordCustomFields(
  ctx: RouterCtx,
  recordType: CustomRecordType,
  recordId: string,
): Promise<unknown[]> {
  await ensureRecordVisible(ctx, recordType, recordId);

  const { data: definitions, error: definitionError } = await ctx.callerDb
    .from("crm_custom_field_definitions")
    .select("id, key, label, data_type, required, visibility_roles, sort_order, constraints")
    .eq("workspace_id", ctx.workspaceId)
    .eq("object_type", recordType)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });
  if (definitionError) throw definitionError;

  const definitionIds = (definitions ?? []).map((row) => row.id);
  if (definitionIds.length === 0) return [];

  const { data: values, error: valuesError } = await ctx.callerDb
    .from("crm_custom_field_values")
    .select("definition_id, value")
    .eq("workspace_id", ctx.workspaceId)
    .eq("record_type", recordType)
    .eq("record_id", recordId)
    .in("definition_id", definitionIds);
  if (valuesError) throw valuesError;

  const valueMap = new Map((values ?? []).map((row) => [row.definition_id, row.value]));

  return (definitions ?? []).map((definition) => ({
    definitionId: definition.id,
    key: definition.key,
    label: definition.label,
    dataType: definition.data_type,
    required: definition.required,
    visibilityRoles: definition.visibility_roles ?? [],
    sortOrder: definition.sort_order,
    constraints: definition.constraints ?? {},
    value: valueMap.get(definition.id) ?? null,
  }));
}

export async function upsertRecordCustomFields(
  ctx: RouterCtx,
  recordType: CustomRecordType,
  recordId: string,
  valuesByKey: Record<string, unknown>,
): Promise<unknown[]> {
  await ensureRecordVisible(ctx, recordType, recordId);

  const { data: definitions, error: definitionError } = await ctx.callerDb
    .from("crm_custom_field_definitions")
    .select("id, key, data_type, required")
    .eq("workspace_id", ctx.workspaceId)
    .eq("object_type", recordType)
    .is("deleted_at", null);
  if (definitionError) throw definitionError;

  const byKey = new Map((definitions ?? []).map((definition) => [definition.key, definition]));
  const upserts: Array<Record<string, unknown>> = [];

  for (const [rawKey, rawValue] of Object.entries(valuesByKey)) {
    const key = normalizeKey(rawKey);
    const definition = byKey.get(key);
    if (!definition) throw new Error(`UNKNOWN_CUSTOM_FIELD:${rawKey}`);
    if (!isValidCustomValue(definition.data_type, rawValue)) {
      throw new Error(`INVALID_CUSTOM_FIELD_TYPE:${rawKey}`);
    }

    upserts.push({
      workspace_id: ctx.workspaceId,
      definition_id: definition.id,
      record_type: recordType,
      record_id: recordId,
      value: rawValue,
    });
  }

  if (upserts.length > 0) {
    const { error } = await ctx.callerDb
      .from("crm_custom_field_values")
      .upsert(upserts, { onConflict: "definition_id,record_type,record_id" });
    if (error) throw error;
  }

  const { data: existingValues, error: existingError } = await ctx.callerDb
    .from("crm_custom_field_values")
    .select("definition_id, value")
    .eq("workspace_id", ctx.workspaceId)
    .eq("record_type", recordType)
    .eq("record_id", recordId);
  if (existingError) throw existingError;

  const valueMap = new Map((existingValues ?? []).map((row) => [row.definition_id, row.value]));
  const missingRequired = (definitions ?? [])
    .filter((definition) => definition.required)
    .filter((definition) => {
      const value = valueMap.get(definition.id);
      if (value === null || value === undefined) return true;
      if (typeof value === "string" && value.trim().length === 0) return true;
      return false;
    })
    .map((definition) => definition.key);

  if (missingRequired.length > 0) {
    throw new Error(`MISSING_REQUIRED_CUSTOM_FIELDS:${missingRequired.join(",")}`);
  }

  return getRecordCustomFields(ctx, recordType, recordId);
}

export async function listDuplicateCandidates(
  ctx: RouterCtx,
  status: "open" | "dismissed" | "merged" = "open",
): Promise<unknown[]> {
  const { data: rows, error } = await ctx.callerDb
    .from("crm_duplicate_candidates")
    .select("id, rule_id, score, status, left_contact_id, right_contact_id, created_at, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("status", status)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const ids = new Set<string>();
  for (const row of rows ?? []) {
    ids.add(String(row.left_contact_id));
    ids.add(String(row.right_contact_id));
  }

  const contactIds = Array.from(ids);
  const contactMap = new Map<string, unknown>();
  if (contactIds.length > 0) {
    const { data: contacts, error: contactError } = await ctx.callerDb
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone, title, assigned_rep_id")
      .in("id", contactIds)
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null);
    if (contactError) throw contactError;

    for (const contact of contacts ?? []) {
      contactMap.set(String(contact.id), {
        id: contact.id,
        firstName: contact.first_name,
        lastName: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        title: contact.title,
        assignedRepId: contact.assigned_rep_id,
      });
    }
  }

  return (rows ?? []).map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    score: row.score,
    status: row.status,
    leftContact: contactMap.get(String(row.left_contact_id)) ?? null,
    rightContact: contactMap.get(String(row.right_contact_id)) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function dismissDuplicateCandidate(
  ctx: RouterCtx,
  candidateId: string,
): Promise<void> {
  const { error } = await ctx.callerDb
    .from("crm_duplicate_candidates")
    .update({ status: "dismissed" })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", candidateId);
  if (error) throw error;
}
