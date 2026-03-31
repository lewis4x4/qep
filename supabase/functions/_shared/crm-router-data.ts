import { fetchCompanySubtreeIdSet, type RouterCtx } from "./crm-router-service.ts";
import { deliverCrmCommunication } from "./crm-communication-delivery.ts";

export type CustomRecordType = "contact" | "company" | "equipment";

export type EquipmentCategory =
  | "excavator" | "loader" | "backhoe" | "dozer" | "skid_steer"
  | "crane" | "forklift" | "telehandler"
  | "truck" | "trailer" | "dump_truck"
  | "aerial_lift" | "boom_lift" | "scissor_lift"
  | "compactor" | "roller"
  | "generator" | "compressor" | "pump" | "welder"
  | "attachment" | "bucket" | "breaker"
  | "concrete" | "paving"
  | "drill" | "boring"
  | "other";

export type EquipmentCondition = "new" | "excellent" | "good" | "fair" | "poor" | "salvage";
export type EquipmentAvailability = "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned";
export type EquipmentOwnership = "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
export type DealEquipmentRole = "subject" | "trade_in" | "rental" | "part_exchange";

export interface EquipmentPayload {
  companyId: string;
  name: string;
  assetTag?: string | null;
  serialNumber?: string | null;
  primaryContactId?: string | null;
  metadata?: Record<string, unknown>;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  category?: EquipmentCategory | null;
  vinPin?: string | null;
  condition?: EquipmentCondition | null;
  availability?: EquipmentAvailability | null;
  ownership?: EquipmentOwnership | null;
  engineHours?: number | null;
  mileage?: number | null;
  fuelType?: string | null;
  weightClass?: string | null;
  operatingCapacity?: string | null;
  locationDescription?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  purchasePrice?: number | null;
  currentMarketValue?: number | null;
  replacementCost?: number | null;
  dailyRentalRate?: number | null;
  weeklyRentalRate?: number | null;
  monthlyRentalRate?: number | null;
  warrantyExpiresOn?: string | null;
  lastInspectionAt?: string | null;
  nextServiceDueAt?: string | null;
  notes?: string | null;
  photoUrls?: string[];
}

export interface DealEquipmentPayload {
  dealId: string;
  equipmentId: string;
  role?: DealEquipmentRole;
  notes?: string | null;
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
  task?: {
    dueAt?: string | null;
    status?: "open" | "completed";
  };
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  sendNow?: boolean;
}

export interface ActivityPatchPayload {
  body?: string | null;
  occurredAt?: string;
  updatedAt?: string;
  task?: {
    dueAt?: string | null;
    status?: "open" | "completed";
  };
  archive?: boolean;
}

export interface ActivityDeliverPayload {
  sendNow?: boolean;
  updatedAt?: string;
}

export type FollowUpReminderSource = "pipeline_quick" | "deal_detail" | "voice" | "system";

export interface DealPatchPayload {
  name?: string;
  stageId?: string;
  primaryContactId?: string | null;
  companyId?: string | null;
  amount?: number | null;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  closedAt?: string | null;
  lossReason?: string | null;
  competitor?: string | null;
  archive?: boolean;
  /** Optional telemetry for crm_reminder_instances.source */
  followUpReminderSource?: FollowUpReminderSource;
}

export interface ContactUpsertPayload {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  primaryCompanyId?: string | null;
  archive?: boolean;
}

export interface CompanyUpsertPayload {
  name?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  archive?: boolean;
}

export interface DealCreatePayload {
  name?: string;
  stageId?: string;
  primaryContactId?: string | null;
  companyId?: string | null;
  amount?: number | null;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  followUpReminderSource?: FollowUpReminderSource;
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function syncFollowUpReminderFromDealRow(
  ctx: RouterCtx,
  dealId: string,
  row: { next_follow_up_at: string | null; closed_at: string | null },
  source: FollowUpReminderSource,
): Promise<void> {
  const due = row.closed_at ? null : row.next_follow_up_at;
  const { error } = await ctx.callerDb.rpc("crm_schedule_follow_up_reminder", {
    p_deal_id: dealId,
    p_due_at: due,
    p_source: source,
  });
  if (error) {
    console.error("[crm-router-data] crm_schedule_follow_up_reminder failed", error);
  }
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

async function getActivityForPatch(
  ctx: RouterCtx,
  activityId: string,
): Promise<{
  id: string;
  activityType: string;
  body: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}> {
  const { data, error } = await ctx.callerDb
    .from("crm_activities")
    .select("id, activity_type, body, contact_id, company_id, deal_id, metadata, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", activityId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");

  return {
    id: data.id,
    activityType: data.activity_type,
    body: data.body,
    contactId: data.contact_id,
    companyId: data.company_id,
    dealId: data.deal_id,
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {},
    updatedAt: data.updated_at,
  };
}

const EQUIPMENT_SELECT_COLS = [
  "id", "company_id", "primary_contact_id", "name", "asset_tag", "serial_number",
  "make", "model", "year", "category", "vin_pin",
  "condition", "availability", "ownership",
  "engine_hours", "mileage", "fuel_type", "weight_class", "operating_capacity",
  "location_description", "latitude", "longitude",
  "purchase_price", "current_market_value", "replacement_cost",
  "daily_rental_rate", "weekly_rental_rate", "monthly_rental_rate",
  "warranty_expires_on", "last_inspection_at", "next_service_due_at",
  "notes", "photo_urls",
  "metadata", "created_at", "updated_at",
].join(", ");

// deno-lint-ignore no-explicit-any
function mapEquipmentRow(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    primaryContactId: row.primary_contact_id,
    name: row.name,
    assetTag: row.asset_tag,
    serialNumber: row.serial_number,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    category: row.category ?? null,
    vinPin: row.vin_pin ?? null,
    condition: row.condition ?? null,
    availability: row.availability ?? "available",
    ownership: row.ownership ?? "customer_owned",
    engineHours: row.engine_hours != null ? Number(row.engine_hours) : null,
    mileage: row.mileage != null ? Number(row.mileage) : null,
    fuelType: row.fuel_type ?? null,
    weightClass: row.weight_class ?? null,
    operatingCapacity: row.operating_capacity ?? null,
    locationDescription: row.location_description ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
    currentMarketValue: row.current_market_value != null ? Number(row.current_market_value) : null,
    replacementCost: row.replacement_cost != null ? Number(row.replacement_cost) : null,
    dailyRentalRate: row.daily_rental_rate != null ? Number(row.daily_rental_rate) : null,
    weeklyRentalRate: row.weekly_rental_rate != null ? Number(row.weekly_rental_rate) : null,
    monthlyRentalRate: row.monthly_rental_rate != null ? Number(row.monthly_rental_rate) : null,
    warrantyExpiresOn: row.warranty_expires_on ?? null,
    lastInspectionAt: row.last_inspection_at ?? null,
    nextServiceDueAt: row.next_service_due_at ?? null,
    notes: row.notes ?? null,
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEquipment(
  ctx: RouterCtx,
  companyId: string | null,
): Promise<unknown[]> {
  let query = ctx.callerDb
    .from("crm_equipment")
    .select(EQUIPMENT_SELECT_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(mapEquipmentRow);
}

export async function listEquipmentForCompanySubtree(
  ctx: RouterCtx,
  rootCompanyId: string,
): Promise<unknown[]> {
  const subtree = await fetchCompanySubtreeIdSet(ctx, rootCompanyId);
  if (!subtree) {
    throw new Error("NOT_FOUND");
  }

  const ids = Array.from(subtree);
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await ctx.callerDb
    .from("crm_equipment")
    .select(EQUIPMENT_SELECT_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .in("company_id", ids)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const rows = data ?? [];
  const companyIds = [...new Set(rows.map((row) => String(row.company_id)))];
  let nameMap = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: compRows, error: compError } = await ctx.callerDb
      .from("crm_companies")
      .select("id, name")
      .eq("workspace_id", ctx.workspaceId)
      .in("id", companyIds);
    if (compError) throw compError;
    nameMap = new Map((compRows ?? []).map((r) => [String(r.id), String(r.name)]));
  }

  return rows.map((row) => ({
    ...mapEquipmentRow(row),
    companyName: nameMap.get(String(row.company_id)) ?? null,
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
  if (
    !["note", "call", "email", "meeting", "task", "sms"].includes(activityType)
  ) {
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

  const metadata: Record<string, unknown> = {};
  if (activityType === "email" || activityType === "sms") {
    metadata.communication = await deliverCrmCommunication(ctx, {
      activityType,
      sendNow: payload.sendNow === true,
      body: cleanText(payload.body ?? null),
      contactId,
      companyId,
      dealId,
    });
  }
  if (activityType === "task") {
    const dueAt = cleanText(payload.task?.dueAt ?? null);
    if (dueAt && Number.isNaN(Date.parse(dueAt))) {
      throw new Error("VALIDATION_INVALID_TASK_DUE_AT");
    }
    const rawStatus = payload.task?.status;
    if (rawStatus !== undefined && rawStatus !== "open" && rawStatus !== "completed") {
      throw new Error("VALIDATION_INVALID_TASK_STATUS");
    }
    const status = rawStatus ?? "open";
    metadata.task = {
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      status,
    };
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
      metadata,
    })
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at",
    )
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
    metadata: (data.metadata as Record<string, unknown> | null) ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function patchActivity(
  ctx: RouterCtx,
  activityId: string,
  payload: ActivityPatchPayload,
): Promise<unknown> {
  const activity = await getActivityForPatch(ctx, activityId);
  const hasBody = Object.prototype.hasOwnProperty.call(payload, "body");
  const hasOccurredAt = Object.prototype.hasOwnProperty.call(payload, "occurredAt");
  const hasTask = Object.prototype.hasOwnProperty.call(payload, "task");
  const hasArchive = payload.archive === true;
  const expectedUpdatedAt = cleanText(payload.updatedAt ?? null);

  if (!hasBody && !hasOccurredAt && !hasTask && !hasArchive) {
    throw new Error("VALIDATION_ACTIVITY_PATCH_REQUIRED");
  }
  if (expectedUpdatedAt && expectedUpdatedAt !== activity.updatedAt) {
    throw new Error("VALIDATION_ACTIVITY_STALE");
  }

  const updates: Record<string, unknown> = {};

  if (hasBody) {
    const body = cleanText(payload.body ?? null);
    if (!body) {
      throw new Error("VALIDATION_ACTIVITY_BODY_REQUIRED");
    }

    if (activity.activityType === "email" || activity.activityType === "sms") {
      const communication =
        activity.metadata.communication &&
          typeof activity.metadata.communication === "object" &&
          !Array.isArray(activity.metadata.communication)
          ? (activity.metadata.communication as Record<string, unknown>)
          : null;

      if (communication?.status === "sent") {
        throw new Error("VALIDATION_ACTIVITY_BODY_LOCKED");
      }
      if (communication?.deliveryInProgress === true) {
        throw new Error("VALIDATION_ACTIVITY_BODY_LOCKED");
      }

      const inProgressAt = typeof communication?.deliveryInProgressAt === "string"
        ? Date.parse(communication.deliveryInProgressAt)
        : Number.NaN;
      const hasFreshDeliveryLock =
        communication?.deliveryInProgress === true &&
        Number.isFinite(inProgressAt) &&
        Date.now() - inProgressAt < 2 * 60 * 1000;
      if (hasFreshDeliveryLock) {
        throw new Error("VALIDATION_ACTIVITY_DELIVERY_IN_PROGRESS");
      }
    }

    updates.body = body;
  }

  if (hasOccurredAt) {
    if (!payload.occurredAt || Number.isNaN(Date.parse(payload.occurredAt))) {
      throw new Error("VALIDATION_INVALID_OCCURRED_AT");
    }

    if (activity.activityType === "email" || activity.activityType === "sms") {
      const communication =
        activity.metadata.communication &&
          typeof activity.metadata.communication === "object" &&
          !Array.isArray(activity.metadata.communication)
          ? (activity.metadata.communication as Record<string, unknown>)
          : null;

      if (communication?.status === "sent" || communication?.deliveryInProgress === true) {
        throw new Error("VALIDATION_ACTIVITY_OCCURRED_AT_LOCKED");
      }
    }

    updates.occurred_at = new Date(payload.occurredAt).toISOString();
  }

  if (hasTask) {
    if (!payload.task || activity.activityType !== "task") {
      throw new Error("VALIDATION_ACTIVITY_PATCH_UNSUPPORTED");
    }

    const hasDueAt = Object.prototype.hasOwnProperty.call(payload.task, "dueAt");
    const dueAt = hasDueAt ? cleanText(payload.task.dueAt ?? null) : undefined;
    if (dueAt && Number.isNaN(Date.parse(dueAt))) {
      throw new Error("VALIDATION_INVALID_TASK_DUE_AT");
    }
    const rawStatus = Object.prototype.hasOwnProperty.call(payload.task, "status")
      ? payload.task.status
      : undefined;
    if (rawStatus !== undefined && rawStatus !== "open" && rawStatus !== "completed") {
      throw new Error("VALIDATION_INVALID_TASK_STATUS");
    }

    const existingTask =
      activity.metadata.task && typeof activity.metadata.task === "object" && !Array.isArray(activity.metadata.task)
        ? (activity.metadata.task as Record<string, unknown>)
        : {};

    updates.metadata = {
      ...activity.metadata,
      task: {
        dueAt: dueAt === undefined
          ? (existingTask.dueAt as string | null | undefined) ?? null
          : dueAt
          ? new Date(dueAt).toISOString()
          : null,
        status: rawStatus ?? (existingTask.status === "completed" ? "completed" : "open"),
      },
    };
  }

  if (hasArchive) {
    if (activity.activityType === "email" || activity.activityType === "sms") {
      const communication =
        activity.metadata.communication &&
          typeof activity.metadata.communication === "object" &&
          !Array.isArray(activity.metadata.communication)
          ? (activity.metadata.communication as Record<string, unknown>)
          : null;

      const status = typeof communication?.status === "string" ? communication.status : null;
      const inProgressAt = typeof communication?.deliveryInProgressAt === "string"
        ? Date.parse(communication.deliveryInProgressAt)
        : Number.NaN;
      const hasFreshDeliveryLock =
        communication?.deliveryInProgress === true &&
        Number.isFinite(inProgressAt) &&
        Date.now() - inProgressAt < 2 * 60 * 1000;

      if (status === "sent" || hasFreshDeliveryLock || communication?.deliveryInProgress === true) {
        throw new Error("VALIDATION_ACTIVITY_ARCHIVE_LOCKED");
      }
    }

    updates.deleted_at = new Date().toISOString();
  }

  const { data, error } = await ctx.callerDb
    .from("crm_activities")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", activityId)
    .eq("updated_at", expectedUpdatedAt ?? activity.updatedAt)
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at",
    )
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("VALIDATION_ACTIVITY_STALE");
  }

  if (hasTask && activity.activityType === "task" && payload.task?.status === "completed") {
    const md = activity.metadata as Record<string, unknown> | null;
    const fr = md?.follow_up_reminder;
    const reminderId =
      fr && typeof fr === "object" && !Array.isArray(fr)
        ? (fr as { reminderId?: unknown }).reminderId
        : undefined;
    if (typeof reminderId === "string") {
      const { error: dismissErr } = await ctx.callerDb.rpc("crm_dismiss_follow_up_reminder", {
        p_reminder_id: reminderId,
      });
      if (dismissErr) {
        console.error("[crm-router-data] crm_dismiss_follow_up_reminder failed", dismissErr);
      }
    }
  }

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
    metadata: (data.metadata as Record<string, unknown> | null) ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function deliverActivity(
  ctx: RouterCtx,
  activityId: string,
  payload: ActivityDeliverPayload,
): Promise<unknown> {
  const activity = await getActivityForPatch(ctx, activityId);
  const expectedUpdatedAt = cleanText(payload.updatedAt ?? null);
  if (expectedUpdatedAt && expectedUpdatedAt !== activity.updatedAt) {
    throw new Error("VALIDATION_ACTIVITY_STALE");
  }
  if (activity.activityType !== "email" && activity.activityType !== "sms") {
    throw new Error("VALIDATION_ACTIVITY_DELIVERY_UNSUPPORTED");
  }
  const communication =
    activity.metadata.communication &&
      typeof activity.metadata.communication === "object" &&
      !Array.isArray(activity.metadata.communication)
      ? (activity.metadata.communication as Record<string, unknown>)
      : null;
  const inProgressAt = typeof communication?.deliveryInProgressAt === "string"
    ? Date.parse(communication.deliveryInProgressAt)
    : Number.NaN;
  const hasFreshDeliveryLock =
    communication?.deliveryInProgress === true &&
    Number.isFinite(inProgressAt) &&
    Date.now() - inProgressAt < 2 * 60 * 1000;
  if (hasFreshDeliveryLock) {
    throw new Error("VALIDATION_ACTIVITY_DELIVERY_IN_PROGRESS");
  }
  if (communication?.deliveryInProgress === true) {
    throw new Error("VALIDATION_ACTIVITY_DELIVERY_REVIEW_REQUIRED");
  }
  if (communication?.status === "sent") {
    throw new Error("VALIDATION_ACTIVITY_DELIVERY_ALREADY_SENT");
  }

  const claimMetadata = {
    ...activity.metadata,
    communication: {
      ...(communication ?? {}),
      deliveryInProgress: true,
      deliveryInProgressAt: new Date().toISOString(),
    },
  };

  const { data: claimedActivity, error: claimError } = await ctx.callerDb
    .from("crm_activities")
    .update({
      metadata: claimMetadata,
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", activityId)
    .eq("updated_at", expectedUpdatedAt ?? activity.updatedAt)
    .select("id")
    .maybeSingle();

  if (claimError) throw claimError;
  if (!claimedActivity) {
    throw new Error("VALIDATION_ACTIVITY_DELIVERY_IN_PROGRESS");
  }

  let deliveredCommunication: Record<string, unknown>;
  try {
    deliveredCommunication = await deliverCrmCommunication(ctx, {
      activityType: activity.activityType,
      sendNow: payload.sendNow !== false,
      body: cleanText(activity.body ?? null),
      contactId: activity.contactId,
      companyId: activity.companyId,
      dealId: activity.dealId,
    });
  } catch (error) {
    await ctx.callerDb
      .from("crm_activities")
      .update({
        metadata: {
          ...activity.metadata,
          communication: communication ?? {},
        },
      })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", activityId);
    throw error;
  }

  const nextMetadata = {
    ...activity.metadata,
    communication: deliveredCommunication,
  };

  const { data, error } = await ctx.callerDb
    .from("crm_activities")
    .update({
      metadata: nextMetadata,
    })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", activityId)
    .select(
      "id, workspace_id, activity_type, body, occurred_at, contact_id, company_id, deal_id, created_by, metadata, created_at, updated_at",
    )
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
    metadata: (data.metadata as Record<string, unknown> | null) ?? {},
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

async function resolveStage(
  ctx: RouterCtx,
  stageId: string,
): Promise<
  {
    id: string;
    isClosedWon: boolean;
    isClosedLost: boolean;
  } | null
> {
  const { data, error } = await ctx.callerDb
    .from("crm_deal_stages")
    .select("id, is_closed_won, is_closed_lost")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", stageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    isClosedWon: Boolean(data.is_closed_won),
    isClosedLost: Boolean(data.is_closed_lost),
  };
}

export async function createContact(
  ctx: RouterCtx,
  payload: ContactUpsertPayload,
): Promise<unknown> {
  const firstName = cleanText(payload.firstName);
  const lastName = cleanText(payload.lastName);
  if (!firstName) throw new Error("VALIDATION_FIRST_NAME_REQUIRED");
  if (!lastName) throw new Error("VALIDATION_LAST_NAME_REQUIRED");

  const primaryCompanyId = cleanText(payload.primaryCompanyId ?? null);
  if (primaryCompanyId) {
    await ensureRecordVisible(ctx, "company", primaryCompanyId);
  }

  const { data, error } = await ctx.callerDb
    .from("crm_contacts")
    .insert({
      workspace_id: ctx.workspaceId,
      first_name: firstName,
      last_name: lastName,
      email: cleanText(payload.email ?? null),
      phone: cleanText(payload.phone ?? null),
      title: cleanText(payload.title ?? null),
      primary_company_id: primaryCompanyId,
      assigned_rep_id: ctx.caller.userId,
    })
    .select(
      "id, workspace_id, dge_customer_profile_id, first_name, last_name, email, phone, title, primary_company_id, assigned_rep_id, merged_into_contact_id, created_at, updated_at",
    )
    .single();

  if (error) throw error;
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    dgeCustomerProfileId: data.dge_customer_profile_id,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone,
    title: data.title,
    primaryCompanyId: data.primary_company_id,
    assignedRepId: data.assigned_rep_id,
    mergedIntoContactId: data.merged_into_contact_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function patchContact(
  ctx: RouterCtx,
  contactId: string,
  payload: ContactUpsertPayload,
): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  const hasArchive = payload.archive === true;

  if (payload.firstName !== undefined) {
    const firstName = cleanText(payload.firstName);
    if (!firstName) throw new Error("VALIDATION_FIRST_NAME_REQUIRED");
    updates.first_name = firstName;
  }

  if (payload.lastName !== undefined) {
    const lastName = cleanText(payload.lastName);
    if (!lastName) throw new Error("VALIDATION_LAST_NAME_REQUIRED");
    updates.last_name = lastName;
  }

  if (payload.email !== undefined) {
    updates.email = cleanText(payload.email ?? null);
  }

  if (payload.phone !== undefined) {
    updates.phone = cleanText(payload.phone ?? null);
  }

  if (payload.title !== undefined) {
    updates.title = cleanText(payload.title ?? null);
  }

  let nextPrimaryCompanyId: string | null | undefined;
  if (payload.primaryCompanyId !== undefined) {
    nextPrimaryCompanyId = cleanText(payload.primaryCompanyId ?? null);
    if (nextPrimaryCompanyId) {
      await ensureRecordVisible(ctx, "company", nextPrimaryCompanyId);
    }
    updates.primary_company_id = nextPrimaryCompanyId;
  }

  if (hasArchive) {
    const { data, error } = await ctx.callerDb.rpc("archive_crm_contact", {
      p_contact_id: contactId,
    });
    if (error) throw error;
    return data;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("VALIDATION_EMPTY_PATCH");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_contacts")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", contactId)
    .is("deleted_at", null)
    .select(
      "id, workspace_id, dge_customer_profile_id, first_name, last_name, email, phone, title, primary_company_id, assigned_rep_id, merged_into_contact_id, created_at, updated_at",
    )
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    dgeCustomerProfileId: data.dge_customer_profile_id,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    phone: data.phone,
    title: data.title,
    primaryCompanyId: data.primary_company_id,
    assignedRepId: data.assigned_rep_id,
    mergedIntoContactId: data.merged_into_contact_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function createCompany(
  ctx: RouterCtx,
  payload: CompanyUpsertPayload,
): Promise<unknown> {
  const name = cleanText(payload.name);
  if (!name) throw new Error("VALIDATION_NAME_REQUIRED");

  const { data, error } = await ctx.callerDb
    .from("crm_companies")
    .insert({
      workspace_id: ctx.workspaceId,
      name,
      assigned_rep_id: ctx.caller.userId,
      address_line_1: cleanText(payload.addressLine1 ?? null),
      address_line_2: cleanText(payload.addressLine2 ?? null),
      city: cleanText(payload.city ?? null),
      state: cleanText(payload.state ?? null),
      postal_code: cleanText(payload.postalCode ?? null),
      country: cleanText(payload.country ?? null),
    })
    .select(
      "id, workspace_id, name, parent_company_id, assigned_rep_id, address_line_1, address_line_2, city, state, postal_code, country, created_at, updated_at",
    )
    .single();

  if (error) throw error;
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    parentCompanyId: data.parent_company_id,
    assignedRepId: data.assigned_rep_id,
    addressLine1: data.address_line_1,
    addressLine2: data.address_line_2,
    city: data.city,
    state: data.state,
    postalCode: data.postal_code,
    country: data.country,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function patchCompany(
  ctx: RouterCtx,
  companyId: string,
  payload: CompanyUpsertPayload,
): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  const hasArchive = payload.archive === true;

  if (payload.name !== undefined) {
    const name = cleanText(payload.name);
    if (!name) throw new Error("VALIDATION_NAME_REQUIRED");
    updates.name = name;
  }

  if (payload.addressLine1 !== undefined) {
    updates.address_line_1 = cleanText(payload.addressLine1 ?? null);
  }
  if (payload.addressLine2 !== undefined) {
    updates.address_line_2 = cleanText(payload.addressLine2 ?? null);
  }
  if (payload.city !== undefined) {
    updates.city = cleanText(payload.city ?? null);
  }
  if (payload.state !== undefined) {
    updates.state = cleanText(payload.state ?? null);
  }
  if (payload.postalCode !== undefined) {
    updates.postal_code = cleanText(payload.postalCode ?? null);
  }
  if (payload.country !== undefined) {
    updates.country = cleanText(payload.country ?? null);
  }

  if (hasArchive) {
    const { data, error } = await ctx.callerDb.rpc("archive_crm_company", {
      p_company_id: companyId,
    });
    if (error) throw error;
    return data;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("VALIDATION_EMPTY_PATCH");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_companies")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", companyId)
    .is("deleted_at", null)
    .select(
      "id, workspace_id, name, parent_company_id, assigned_rep_id, address_line_1, address_line_2, city, state, postal_code, country, created_at, updated_at",
    )
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    parentCompanyId: data.parent_company_id,
    assignedRepId: data.assigned_rep_id,
    addressLine1: data.address_line_1,
    addressLine2: data.address_line_2,
    city: data.city,
    state: data.state,
    postalCode: data.postal_code,
    country: data.country,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function createDeal(
  ctx: RouterCtx,
  payload: DealCreatePayload,
): Promise<unknown> {
  const name = cleanText(payload.name);
  if (!name) throw new Error("VALIDATION_NAME_REQUIRED");

  const stageId = cleanText(payload.stageId);
  if (!stageId) throw new Error("VALIDATION_STAGE_REQUIRED");

  const stage = await resolveStage(ctx, stageId);
  if (!stage) throw new Error("VALIDATION_STAGE_NOT_FOUND");
  if (stage.isClosedWon || stage.isClosedLost) {
    throw new Error("VALIDATION_STAGE_CREATE_OPEN_ONLY");
  }

  const primaryContactId = cleanText(payload.primaryContactId ?? null);
  if (primaryContactId) {
    await ensureRecordVisible(ctx, "contact", primaryContactId);
  }

  const companyId = cleanText(payload.companyId ?? null);
  if (companyId) {
    await ensureRecordVisible(ctx, "company", companyId);
  }

  if (payload.amount !== undefined && payload.amount !== null) {
    if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount)) {
      throw new Error("VALIDATION_INVALID_AMOUNT");
    }
  }

  const expectedCloseOn = cleanText(payload.expectedCloseOn ?? null);
  if (expectedCloseOn && Number.isNaN(Date.parse(expectedCloseOn))) {
    throw new Error("VALIDATION_INVALID_EXPECTED_CLOSE");
  }

  const nextFollowUpAt = cleanText(payload.nextFollowUpAt ?? null);
  if (nextFollowUpAt && Number.isNaN(Date.parse(nextFollowUpAt))) {
    throw new Error("VALIDATION_INVALID_FOLLOW_UP");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_deals")
    .insert({
      workspace_id: ctx.workspaceId,
      name,
      stage_id: stage.id,
      primary_contact_id: primaryContactId,
      company_id: companyId,
      assigned_rep_id: ctx.caller.userId,
      amount: payload.amount ?? null,
      expected_close_on: expectedCloseOn,
      next_follow_up_at: nextFollowUpAt,
    })
    .select(
      "id, workspace_id, name, stage_id, primary_contact_id, company_id, assigned_rep_id, amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, hubspot_deal_id, created_at, updated_at",
    )
    .single();

  if (error) throw error;

  await syncFollowUpReminderFromDealRow(
    ctx,
    data.id,
    { next_follow_up_at: data.next_follow_up_at, closed_at: data.closed_at },
    payload.followUpReminderSource ?? "deal_detail",
  );

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    stageId: data.stage_id,
    primaryContactId: data.primary_contact_id,
    companyId: data.company_id,
    assignedRepId: data.assigned_rep_id,
    amount: data.amount,
    expectedCloseOn: data.expected_close_on,
    nextFollowUpAt: data.next_follow_up_at,
    lastActivityAt: data.last_activity_at,
    closedAt: data.closed_at,
    hubspotDealId: data.hubspot_deal_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function patchDeal(
  ctx: RouterCtx,
  dealId: string,
  payload: DealPatchPayload,
): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  const hasArchive = payload.archive === true;

  if (payload.name !== undefined) {
    const name = cleanText(payload.name);
    if (!name) {
      throw new Error("VALIDATION_NAME_REQUIRED");
    }
    updates.name = name;
  }

  if (payload.primaryContactId !== undefined) {
    const primaryContactId = cleanText(payload.primaryContactId ?? null);
    if (primaryContactId) {
      await ensureRecordVisible(ctx, "contact", primaryContactId);
    }
    updates.primary_contact_id = primaryContactId;
  }

  if (payload.companyId !== undefined) {
    const companyId = cleanText(payload.companyId ?? null);
    if (companyId) {
      await ensureRecordVisible(ctx, "company", companyId);
    }
    updates.company_id = companyId;
  }

  if (payload.amount !== undefined) {
    if (payload.amount !== null && (typeof payload.amount !== "number" || !Number.isFinite(payload.amount))) {
      throw new Error("VALIDATION_INVALID_AMOUNT");
    }
    updates.amount = payload.amount;
  }

  if (payload.stageId !== undefined) {
    const stageId = cleanText(payload.stageId);
    if (!stageId) {
      throw new Error("VALIDATION_STAGE_REQUIRED");
    }

    const stage = await resolveStage(ctx, stageId);
    if (!stage) {
      throw new Error("VALIDATION_STAGE_NOT_FOUND");
    }

    updates.stage_id = stage.id;
    updates.closed_at = stage.isClosedWon || stage.isClosedLost
      ? new Date().toISOString()
      : null;

    if (stage.isClosedLost) {
      const lossReason = cleanText(payload.lossReason ?? null);
      if (!lossReason) {
        throw new Error("VALIDATION_CLOSED_LOST_REASON_REQUIRED");
      }
      updates.loss_reason = lossReason;
      updates.competitor = cleanText(payload.competitor ?? null);
    }
  }

  if (payload.expectedCloseOn !== undefined) {
    const expectedCloseOn = cleanText(payload.expectedCloseOn ?? null);
    if (expectedCloseOn && Number.isNaN(Date.parse(expectedCloseOn))) {
      throw new Error("VALIDATION_INVALID_EXPECTED_CLOSE");
    }
    updates.expected_close_on = expectedCloseOn;
  }

  if (payload.nextFollowUpAt !== undefined) {
    const nextFollowUpAt = cleanText(payload.nextFollowUpAt ?? null);
    if (nextFollowUpAt && Number.isNaN(Date.parse(nextFollowUpAt))) {
      throw new Error("VALIDATION_INVALID_FOLLOW_UP");
    }
    updates.next_follow_up_at = nextFollowUpAt;
  }

  if (payload.closedAt !== undefined) {
    const closedAt = cleanText(payload.closedAt ?? null);
    if (closedAt && Number.isNaN(Date.parse(closedAt))) {
      throw new Error("VALIDATION_INVALID_CLOSED_AT");
    }
    updates.closed_at = closedAt;
  }

  const hasLossReason = payload.lossReason !== undefined;
  const hasCompetitor = payload.competitor !== undefined;
  if (hasLossReason || hasCompetitor) {
    const isElevated = ctx.caller.isServiceRole ||
      ctx.caller.role === "admin" ||
      ctx.caller.role === "manager" ||
      ctx.caller.role === "owner";
    if (!isElevated) {
      throw new Error("FORBIDDEN");
    }

    if (hasLossReason) {
      updates.loss_reason = cleanText(payload.lossReason ?? null);
    }
    if (hasCompetitor) {
      updates.competitor = cleanText(payload.competitor ?? null);
    }
  }

  if (hasArchive) {
    const { data, error } = await ctx.callerDb.rpc("archive_crm_deal", {
      p_deal_id: dealId,
    });
    if (error) throw error;
    return data;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("VALIDATION_EMPTY_PATCH");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_deals")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", dealId)
    .is("deleted_at", null)
    .select(
      "id, workspace_id, name, stage_id, primary_contact_id, company_id, assigned_rep_id, amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, hubspot_deal_id, created_at, updated_at",
    )
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");

  const shouldSyncFollowUpReminder =
    payload.nextFollowUpAt !== undefined ||
    payload.stageId !== undefined ||
    payload.closedAt !== undefined;
  if (shouldSyncFollowUpReminder) {
    await syncFollowUpReminderFromDealRow(
      ctx,
      dealId,
      { next_follow_up_at: data.next_follow_up_at, closed_at: data.closed_at },
      payload.followUpReminderSource ?? "deal_detail",
    );
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    stageId: data.stage_id,
    primaryContactId: data.primary_contact_id,
    companyId: data.company_id,
    assignedRepId: data.assigned_rep_id,
    amount: data.amount,
    expectedCloseOn: data.expected_close_on,
    nextFollowUpAt: data.next_follow_up_at,
    lastActivityAt: data.last_activity_at,
    closedAt: data.closed_at,
    hubspotDealId: data.hubspot_deal_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function validateNumericNonNegative(val: number | null | undefined, label: string): void {
  if (val != null && (typeof val !== "number" || !Number.isFinite(val) || val < 0)) {
    throw new Error(`VALIDATION_INVALID_${label}`);
  }
}

function sanitizePhotoUrls(urls: string[] | undefined): string[] {
  if (!urls || !Array.isArray(urls)) return [];
  return urls
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("https://"));
}

function applyEquipmentFields(
  target: Record<string, unknown>,
  payload: Partial<EquipmentPayload>,
): void {
  if (payload.make !== undefined) target.make = cleanText(payload.make ?? null);
  if (payload.model !== undefined) target.model = cleanText(payload.model ?? null);
  if (payload.year !== undefined) {
    if (payload.year != null && (payload.year < 1900 || payload.year > 2100)) {
      throw new Error("VALIDATION_INVALID_YEAR");
    }
    target.year = payload.year;
  }
  if (payload.category !== undefined) target.category = payload.category;
  if (payload.vinPin !== undefined) target.vin_pin = cleanText(payload.vinPin ?? null);
  if (payload.condition !== undefined) target.condition = payload.condition;
  if (payload.availability !== undefined) target.availability = payload.availability;
  if (payload.ownership !== undefined) target.ownership = payload.ownership;
  if (payload.engineHours !== undefined) {
    validateNumericNonNegative(payload.engineHours, "ENGINE_HOURS");
    target.engine_hours = payload.engineHours;
  }
  if (payload.mileage !== undefined) {
    validateNumericNonNegative(payload.mileage, "MILEAGE");
    target.mileage = payload.mileage;
  }
  if (payload.fuelType !== undefined) target.fuel_type = cleanText(payload.fuelType ?? null);
  if (payload.weightClass !== undefined) target.weight_class = cleanText(payload.weightClass ?? null);
  if (payload.operatingCapacity !== undefined) target.operating_capacity = cleanText(payload.operatingCapacity ?? null);
  if (payload.locationDescription !== undefined) target.location_description = cleanText(payload.locationDescription ?? null);
  if (payload.latitude !== undefined) target.latitude = payload.latitude;
  if (payload.longitude !== undefined) target.longitude = payload.longitude;
  if (payload.purchasePrice !== undefined) {
    validateNumericNonNegative(payload.purchasePrice, "PURCHASE_PRICE");
    target.purchase_price = payload.purchasePrice;
  }
  if (payload.currentMarketValue !== undefined) {
    validateNumericNonNegative(payload.currentMarketValue, "MARKET_VALUE");
    target.current_market_value = payload.currentMarketValue;
  }
  if (payload.replacementCost !== undefined) {
    validateNumericNonNegative(payload.replacementCost, "REPLACEMENT_COST");
    target.replacement_cost = payload.replacementCost;
  }
  if (payload.dailyRentalRate !== undefined) {
    validateNumericNonNegative(payload.dailyRentalRate, "DAILY_RATE");
    target.daily_rental_rate = payload.dailyRentalRate;
  }
  if (payload.weeklyRentalRate !== undefined) {
    validateNumericNonNegative(payload.weeklyRentalRate, "WEEKLY_RATE");
    target.weekly_rental_rate = payload.weeklyRentalRate;
  }
  if (payload.monthlyRentalRate !== undefined) {
    validateNumericNonNegative(payload.monthlyRentalRate, "MONTHLY_RATE");
    target.monthly_rental_rate = payload.monthlyRentalRate;
  }
  if (payload.warrantyExpiresOn !== undefined) target.warranty_expires_on = payload.warrantyExpiresOn;
  if (payload.lastInspectionAt !== undefined) target.last_inspection_at = payload.lastInspectionAt;
  if (payload.nextServiceDueAt !== undefined) target.next_service_due_at = payload.nextServiceDueAt;
  if (payload.notes !== undefined) target.notes = cleanText(payload.notes ?? null);
  if (payload.photoUrls !== undefined) target.photo_urls = sanitizePhotoUrls(payload.photoUrls);
}

export async function createEquipment(
  ctx: RouterCtx,
  payload: EquipmentPayload,
): Promise<unknown> {
  const name = cleanText(payload.name);
  if (!name) throw new Error("VALIDATION_NAME_REQUIRED");

  const companyId = cleanText(payload.companyId);
  if (!companyId) throw new Error("VALIDATION_COMPANY_ID_REQUIRED");
  await ensureRecordVisible(ctx, "company", companyId);

  const insertPayload: Record<string, unknown> = {
    workspace_id: ctx.workspaceId,
    company_id: companyId,
    primary_contact_id: payload.primaryContactId ?? null,
    name,
    asset_tag: cleanText(payload.assetTag ?? null),
    serial_number: cleanText(payload.serialNumber ?? null),
    metadata: payload.metadata ?? {},
  };
  applyEquipmentFields(insertPayload, payload);

  const { data, error } = await ctx.callerDb
    .from("crm_equipment")
    .insert(insertPayload)
    .select(EQUIPMENT_SELECT_COLS)
    .single();

  if (error) {
    if (String(error.code) === "23505") {
      const msg = String(error.message ?? "");
      if (msg.includes("vin_pin")) throw new Error("VALIDATION_DUPLICATE_VIN_PIN");
      if (msg.includes("asset_tag")) throw new Error("VALIDATION_DUPLICATE_ASSET_TAG");
      throw new Error("VALIDATION_DUPLICATE_EQUIPMENT");
    }
    throw error;
  }
  return mapEquipmentRow(data);
}

export async function getEquipment(
  ctx: RouterCtx,
  equipmentId: string,
): Promise<unknown> {
  const { data, error } = await ctx.callerDb
    .from("crm_equipment")
    .select(EQUIPMENT_SELECT_COLS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", equipmentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
  return mapEquipmentRow(data);
}

export async function listDealEquipment(
  ctx: RouterCtx,
  dealId: string,
): Promise<unknown[]> {
  const { data, error } = await ctx.callerDb
    .from("crm_deal_equipment")
    .select("id, deal_id, equipment_id, role, notes, created_at, updated_at, crm_equipment(name, make, model, year, category, asset_tag, serial_number, availability, condition)")
    .eq("workspace_id", ctx.workspaceId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((row: any) => {
    const eq = row.crm_equipment;
    return {
      id: row.id,
      dealId: row.deal_id,
      equipmentId: row.equipment_id,
      role: row.role,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      equipment: eq ? {
        name: eq.name,
        make: eq.make,
        model: eq.model,
        year: eq.year,
        category: eq.category,
        assetTag: eq.asset_tag,
        serialNumber: eq.serial_number,
        availability: eq.availability,
        condition: eq.condition,
      } : null,
    };
  });
}

export async function linkDealEquipment(
  ctx: RouterCtx,
  payload: DealEquipmentPayload,
): Promise<unknown> {
  const dealId = cleanText(payload.dealId);
  const equipmentId = cleanText(payload.equipmentId);
  if (!dealId) throw new Error("VALIDATION_DEAL_ID_REQUIRED");
  if (!equipmentId) throw new Error("VALIDATION_EQUIPMENT_ID_REQUIRED");

  const validRoles: DealEquipmentRole[] = ["subject", "trade_in", "rental", "part_exchange"];
  const role = payload.role ?? "subject";
  if (!validRoles.includes(role)) throw new Error("VALIDATION_INVALID_ROLE");

  const { data, error } = await ctx.callerDb
    .from("crm_deal_equipment")
    .insert({
      workspace_id: ctx.workspaceId,
      deal_id: dealId,
      equipment_id: equipmentId,
      role,
      notes: cleanText(payload.notes ?? null),
    })
    .select("id, deal_id, equipment_id, role, notes, created_at, updated_at")
    .single();

  if (error) {
    if (String(error.code) === "23505") {
      throw new Error("VALIDATION_EQUIPMENT_ALREADY_LINKED");
    }
    throw error;
  }
  return {
    id: data.id,
    dealId: data.deal_id,
    equipmentId: data.equipment_id,
    role: data.role,
    notes: data.notes,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function unlinkDealEquipment(
  ctx: RouterCtx,
  linkId: string,
): Promise<void> {
  const id = cleanText(linkId);
  if (!id) throw new Error("VALIDATION_LINK_ID_REQUIRED");

  const { error, count } = await ctx.callerDb
    .from("crm_deal_equipment")
    .delete({ count: "exact" })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id);
  if (error) throw error;
  if (count === 0) throw new Error("NOT_FOUND");
}

export async function patchEquipment(
  ctx: RouterCtx,
  equipmentId: string,
  payload: Partial<EquipmentPayload>,
): Promise<unknown> {
  const updates: Record<string, unknown> = {};
  if (payload.companyId !== undefined) {
    const cid = cleanText(payload.companyId);
    if (cid) await ensureRecordVisible(ctx, "company", cid);
    updates.company_id = cid;
  }
  if (payload.primaryContactId !== undefined) {
    updates.primary_contact_id = payload.primaryContactId;
  }
  if (payload.name !== undefined) {
    const cleaned = cleanText(payload.name);
    if (!cleaned) throw new Error("VALIDATION_NAME_REQUIRED");
    updates.name = cleaned;
  }
  if (payload.assetTag !== undefined) {
    updates.asset_tag = cleanText(payload.assetTag ?? null);
  }
  if (payload.serialNumber !== undefined) {
    updates.serial_number = cleanText(payload.serialNumber ?? null);
  }
  if (payload.metadata !== undefined) updates.metadata = payload.metadata ?? {};
  applyEquipmentFields(updates, payload);

  if (Object.keys(updates).length === 0) {
    throw new Error("VALIDATION_EMPTY_PATCH");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_equipment")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", equipmentId)
    .is("deleted_at", null)
    .select(EQUIPMENT_SELECT_COLS)
    .maybeSingle();

  if (error) {
    if (String(error.code) === "23505") {
      const msg = String(error.message ?? "");
      if (msg.includes("vin_pin")) throw new Error("VALIDATION_DUPLICATE_VIN_PIN");
      if (msg.includes("asset_tag")) throw new Error("VALIDATION_DUPLICATE_ASSET_TAG");
      throw new Error("VALIDATION_DUPLICATE_EQUIPMENT");
    }
    throw error;
  }
  if (!data) throw new Error("NOT_FOUND");

  return mapEquipmentRow(data);
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
    .select(
      "id, object_type, key, label, data_type, required, visibility_roles, sort_order, constraints, updated_at",
    )
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
    .select(
      "id, object_type, key, label, data_type, required, visibility_roles, sort_order, constraints, updated_at",
    )
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
  if (payload.required !== undefined) {
    updates.required = Boolean(payload.required);
  }
  if (payload.visibilityRoles !== undefined) {
    updates.visibility_roles = payload.visibilityRoles;
  }
  if (payload.sortOrder !== undefined) updates.sort_order = payload.sortOrder;
  if (payload.constraints !== undefined) {
    updates.constraints = payload.constraints ?? {};
  }
  if (payload.dataType !== undefined) updates.data_type = payload.dataType;

  if (Object.keys(updates).length === 0) {
    throw new Error("VALIDATION_EMPTY_PATCH");
  }

  const { data, error } = await ctx.callerDb
    .from("crm_custom_field_definitions")
    .update(updates)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", definitionId)
    .is("deleted_at", null)
    .select(
      "id, object_type, key, label, data_type, required, visibility_roles, sort_order, constraints, updated_at",
    )
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
    .select(
      "id, key, label, data_type, required, visibility_roles, sort_order, constraints",
    )
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

  const valueMap = new Map(
    (values ?? []).map((row) => [row.definition_id, row.value]),
  );

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

  const byKey = new Map(
    (definitions ?? []).map((definition) => [definition.key, definition]),
  );
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

  const valueMap = new Map(
    (existingValues ?? []).map((row) => [row.definition_id, row.value]),
  );
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
    throw new Error(
      `MISSING_REQUIRED_CUSTOM_FIELDS:${missingRequired.join(",")}`,
    );
  }

  return getRecordCustomFields(ctx, recordType, recordId);
}

export async function listDuplicateCandidates(
  ctx: RouterCtx,
  status: "open" | "dismissed" | "merged" = "open",
): Promise<unknown[]> {
  const { data: rows, error } = await ctx.callerDb
    .from("crm_duplicate_candidates")
    .select(
      "id, rule_id, score, status, left_contact_id, right_contact_id, created_at, updated_at",
    )
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
