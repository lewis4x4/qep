import type {
  ActivityAction,
  CounterInquiry,
  FluidCapacity,
  MachineProfile,
  MaintenanceInterval,
  PartsPreferences,
  QueueFilter,
  QueueItem,
  RequestActivity,
  RequestItem,
  RequestPriority,
  RequestSource,
  RequestStatus,
  WearPart,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return nullableString(value) ?? fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requestSource(value: unknown): RequestSource {
  return value === "service" ||
    value === "sales" ||
    value === "customer_walkin" ||
    value === "customer_phone" ||
    value === "internal"
    ? value
    : "internal";
}

function requestPriority(value: unknown): RequestPriority {
  return value === "critical" || value === "urgent" || value === "normal" || value === "low" ? value : "normal";
}

function requestStatus(value: unknown): RequestStatus {
  return value === "requested" ||
    value === "acknowledged" ||
    value === "locating" ||
    value === "pulled" ||
    value === "ready" ||
    value === "fulfilled" ||
    value === "cancelled" ||
    value === "backordered"
    ? value
    : "requested";
}

function itemStatus(value: unknown): RequestItem["status"] {
  return value === "pending" || value === "locating" || value === "pulled" || value === "backordered"
    ? value
    : "pending";
}

function activityAction(value: unknown): ActivityAction {
  return value === "status_change" ||
    value === "note_added" ||
    value === "item_added" ||
    value === "item_removed" ||
    value === "assigned" ||
    value === "escalated" ||
    value === "customer_notified" ||
    value === "created"
    ? value
    : "created";
}

function inquiryType(value: unknown): CounterInquiry["inquiry_type"] {
  return value === "lookup" ||
    value === "stock_check" ||
    value === "price_check" ||
    value === "cross_reference" ||
    value === "technical"
    ? value
    : "lookup";
}

function inquiryOutcome(value: unknown): CounterInquiry["outcome"] {
  return value === "resolved" || value === "ordered" || value === "referred" || value === "unresolved"
    ? value
    : "unresolved";
}

function queueFilter(value: unknown): QueueFilter {
  return value === "all" ||
    value === "mine" ||
    value === "unassigned" ||
    value === "service" ||
    value === "customer"
    ? value
    : "all";
}

export function normalizeQueueItems(rows: unknown): QueueItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeQueueItem).filter((row): row is QueueItem => row !== null);
}

export function normalizeQueueItem(value: unknown): QueueItem | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const workspaceId = nullableString(value.workspace_id);
  const requestedBy = nullableString(value.requested_by);
  const createdAt = nullableString(value.created_at);
  const updatedAt = nullableString(value.updated_at);
  if (!id || !workspaceId || !requestedBy || !createdAt || !updatedAt) return null;
  return {
    id,
    workspace_id: workspaceId,
    requested_by: requestedBy,
    assigned_to: nullableString(value.assigned_to),
    request_source: requestSource(value.request_source),
    priority: requestPriority(value.priority),
    status: requestStatus(value.status),
    customer_id: nullableString(value.customer_id),
    customer_name: nullableString(value.customer_name),
    machine_profile_id: nullableString(value.machine_profile_id),
    machine_description: nullableString(value.machine_description),
    work_order_number: nullableString(value.work_order_number),
    bay_number: nullableString(value.bay_number),
    items: normalizeRequestItems(value.items),
    notes: nullableString(value.notes),
    estimated_completion: nullableString(value.estimated_completion),
    auto_escalated: booleanValue(value.auto_escalated),
    escalated_at: nullableString(value.escalated_at),
    created_at: createdAt,
    updated_at: updatedAt,
    fulfilled_at: nullableString(value.fulfilled_at),
    cancelled_at: nullableString(value.cancelled_at),
    requester_name: nullableString(value.requester_name),
    assignee_name: nullableString(value.assignee_name),
    machine_manufacturer: nullableString(value.machine_manufacturer),
    machine_model: nullableString(value.machine_model),
    machine_category: nullableString(value.machine_category),
    age_minutes: numberValue(value.age_minutes) ?? 0,
    priority_sort: numberValue(value.priority_sort) ?? 0,
    is_overdue: booleanValue(value.is_overdue),
  };
}

function normalizeRequestItems(rows: unknown): RequestItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    if (!partNumber) return null;
    return {
      part_number: partNumber,
      description: nullableString(value.description),
      quantity: numberValue(value.quantity) ?? 0,
      status: itemStatus(value.status),
      notes: nullableString(value.notes),
    };
  }).filter((row): row is RequestItem => row !== null);
}

export function normalizeRequestActivities(rows: unknown): RequestActivity[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeRequestActivity).filter((row): row is RequestActivity => row !== null);
}

function normalizeRequestActivity(value: unknown): RequestActivity | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const requestId = nullableString(value.request_id);
  const userId = nullableString(value.user_id);
  const createdAt = nullableString(value.created_at);
  if (!id || !requestId || !userId || !createdAt) return null;
  return {
    id,
    request_id: requestId,
    user_id: userId,
    action: activityAction(value.action),
    from_value: nullableString(value.from_value),
    to_value: nullableString(value.to_value),
    notes: nullableString(value.notes),
    metadata: isRecord(value.metadata) ? value.metadata : null,
    created_at: createdAt,
  };
}

export function normalizeMachineProfiles(rows: unknown): MachineProfile[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeMachineProfile).filter((row): row is MachineProfile => row !== null);
}

export function normalizeMachineProfile(value: unknown): MachineProfile | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const workspaceId = nullableString(value.workspace_id);
  const manufacturer = nullableString(value.manufacturer);
  const model = nullableString(value.model);
  const category = nullableString(value.category);
  const createdAt = nullableString(value.created_at);
  const updatedAt = nullableString(value.updated_at);
  if (!id || !workspaceId || !manufacturer || !model || !category || !createdAt || !updatedAt) return null;
  return {
    id,
    workspace_id: workspaceId,
    manufacturer,
    model,
    model_family: nullableString(value.model_family),
    year_range_start: numberValue(value.year_range_start),
    year_range_end: numberValue(value.year_range_end),
    category,
    specs: objectValue(value.specs),
    maintenance_schedule: normalizeMaintenanceIntervals(value.maintenance_schedule),
    fluid_capacities: normalizeFluidCapacities(value.fluid_capacities),
    common_wear_parts: normalizeWearPartGroups(value.common_wear_parts),
    source_documents: stringArray(value.source_documents),
    extraction_confidence: numberValue(value.extraction_confidence) ?? 0,
    manually_verified: booleanValue(value.manually_verified),
    notes: nullableString(value.notes),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function normalizeMaintenanceIntervals(rows: unknown): MaintenanceInterval[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    return {
      interval_hours: numberValue(value.interval_hours) ?? 0,
      tasks: stringArray(value.tasks),
      ...(Array.isArray(value.parts) ? { parts: stringArray(value.parts) } : {}),
    };
  }).filter((row): row is MaintenanceInterval => row !== null);
}

function normalizeFluidCapacities(value: unknown): Record<string, FluidCapacity> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => {
        if (!isRecord(item)) return null;
        return [key, { capacity: stringValue(item.capacity), spec: stringValue(item.spec) }] as const;
      })
      .filter((entry): entry is readonly [string, FluidCapacity] => entry !== null),
  );
}

function normalizeWearPartGroups(value: unknown): Record<string, WearPart[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, normalizeWearParts(item)] as const)
      .filter((entry): entry is readonly [string, WearPart[]] => entry[1].length > 0),
  );
}

function normalizeWearParts(rows: unknown): WearPart[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const partNumber = nullableString(value.part_number);
    const description = nullableString(value.description);
    if (!partNumber || !description) return null;
    const avgReplaceHours = numberValue(value.avg_replace_hours);
    return {
      part_number: partNumber,
      description,
      ...(avgReplaceHours !== null ? { avg_replace_hours: avgReplaceHours } : {}),
    };
  }).filter((row): row is WearPart => row !== null);
}

export function normalizeCounterInquiries(rows: unknown): CounterInquiry[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeCounterInquiry).filter((row): row is CounterInquiry => row !== null);
}

function normalizeCounterInquiry(value: unknown): CounterInquiry | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const userId = nullableString(value.user_id);
  const queryText = nullableString(value.query_text);
  const createdAt = nullableString(value.created_at);
  if (!id || !userId || !queryText || !createdAt) return null;
  return {
    id,
    user_id: userId,
    inquiry_type: inquiryType(value.inquiry_type),
    machine_profile_id: nullableString(value.machine_profile_id),
    machine_description: nullableString(value.machine_description),
    query_text: queryText,
    result_parts: stringArray(value.result_parts),
    outcome: inquiryOutcome(value.outcome),
    duration_seconds: numberValue(value.duration_seconds),
    created_at: createdAt,
  };
}

export function normalizePartsPreferences(value: unknown): PartsPreferences | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const userId = nullableString(value.user_id);
  if (!id || !userId) return null;
  return {
    id,
    user_id: userId,
    dark_mode: booleanValue(value.dark_mode),
    queue_panel_collapsed: booleanValue(value.queue_panel_collapsed),
    default_queue_filter: queueFilter(value.default_queue_filter),
    show_fulfilled_requests: booleanValue(value.show_fulfilled_requests),
    keyboard_shortcuts_enabled: booleanValue(value.keyboard_shortcuts_enabled),
    sound_notifications: booleanValue(value.sound_notifications),
  };
}
