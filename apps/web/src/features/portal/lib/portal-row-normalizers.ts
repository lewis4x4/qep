export type PortalDocumentType =
  | "operator_manual"
  | "service_manual"
  | "parts_manual"
  | "warranty_certificate"
  | "service_record"
  | "inspection_report"
  | "invoice"
  | "receipt"
  | "photo"
  | "other";

export type PortalFleetItem = {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_hours: number | null;
  stage_label?: string | null;
  last_lat?: number | null;
  last_lng?: number | null;
};

export type PortalMaintenanceScheduleRow = {
  id: string;
  label?: string | null;
  next_due_date?: string | null;
  next_due_hours?: number | null;
};

export type PortalFleetDetailItem = {
  id: string;
  equipment_id?: string | null;
  make: string | null;
  model: string | null;
  name?: string | null;
  year: number | null;
  serial_number: string | null;
  current_hours: number | null;
  warranty_expiry: string | null;
  next_service_due: string | null;
  trade_in_interest?: boolean;
  portal_status?: {
    label: string;
    source_label: string;
    eta: string | null;
    last_updated_at: string | null;
  } | null;
  maintenance_schedules?: PortalMaintenanceScheduleRow[] | null;
};

export type EquipmentDocument = {
  id: string;
  fleet_id: string | null;
  crm_equipment_id: string | null;
  document_type: PortalDocumentType;
  title: string;
  description: string | null;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  customer_visible: boolean;
  created_at: string;
  portal_visibility?: {
    label: string;
    detail: string;
    released_at: string;
  } | null;
};

export type RecentLineItem = {
  part_number?: string;
  quantity?: number;
  description?: string;
  unit_price?: number;
};

export type MachineHistoryRow = {
  fleet_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
  last_ordered_at: string | null;
  total_orders: number;
  recent_line_items:
    | Array<{ li: RecentLineItem[] | RecentLineItem; created_at: string }>
    | null;
};

export type PortalActiveDealRow = {
  deal_id: string;
  deal_name: string;
  amount: number | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  quote_review_id: string | null;
  quote_review_status: string | null;
  portal_status: {
    label: string;
    source: "quote_review" | "deal_progress" | "service_job" | "portal_request" | "default";
    source_label: string;
    eta: string | null;
    last_updated_at: string | null;
    next_action?: string | null;
  };
};

export type PortalInvoiceLineItem = {
  id?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  line_total?: number;
};

export type PortalInvoicePaymentHistoryItem = {
  label: string;
  detail: string;
  amount: number;
  status: "pending" | "processing" | "paid" | "failed";
  reference: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type PortalInvoiceTimelineItem = {
  label: string;
  detail: string;
  at: string | null;
  tone: string;
};

export type PortalInvoiceRecord = Record<string, unknown> & {
  customer_invoice_line_items?: PortalInvoiceLineItem[];
  portal_payment_history?: PortalInvoicePaymentHistoryItem[];
  portal_invoice_timeline?: PortalInvoiceTimelineItem[];
};

export type PortalServiceRequestRow = Record<string, unknown> & {
  id: string;
  request_type: string;
  description: string;
  status: string;
  portal_status?: {
    label: string;
    source: "service_job" | "portal_request" | "default";
    source_label: string;
    eta: string | null;
    last_updated_at: string | null;
  } | null;
  internal_job?: { id: string; current_stage: string | null; closed_at: string | null } | null;
  workspace_timeline?: {
    branch_label: string | null;
    next_step: string | null;
    customer_summary: string | null;
  } | null;
  photo_count?: number;
};

export type PortalServiceRequestsPayload = {
  open_requests: PortalServiceRequestRow[];
  completed_requests: PortalServiceRequestRow[];
  blocked_requests: PortalServiceRequestRow[];
  workspace_summary: {
    open_count: number;
    completed_count: number;
    blocked_count: number;
  } | null;
};

export type PortalServiceTimelinePayload = {
  ok: boolean;
  service_job_id: string | null;
  events: Array<{
    id: string;
    event_type: string;
    created_at: string;
    new_stage?: string | null;
    customer_label: string;
  }>;
};

export type PortalFleetPickerRow = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  serial_number?: string | null;
};

export type PortalPmKitSuggestion =
  | {
      ok: true;
      ai_suggested_pm_kit: boolean;
      ai_suggestion_reason: string;
      line_items: Array<{
        part_number: string;
        quantity: number;
        description?: string;
        is_ai_suggested?: boolean;
      }>;
      matched_job_code: {
        id: string;
        job_name: string;
        make: string;
        model_family: string | null;
      };
    }
  | {
      ok: false;
      error: string;
      message: string;
      matched_job_code?: {
        id: string;
        job_name: string;
        make: string;
        model_family: string | null;
      };
    };

export type PortalCheckoutResponse = {
  url?: string;
  fallback?: string;
  stripe_configured: boolean;
  stripe_error?: boolean;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
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

function documentType(value: unknown): PortalDocumentType {
  return value === "operator_manual" ||
    value === "service_manual" ||
    value === "parts_manual" ||
    value === "warranty_certificate" ||
    value === "service_record" ||
    value === "inspection_report" ||
    value === "invoice" ||
    value === "receipt" ||
    value === "photo" ||
    value === "other"
    ? value
    : "other";
}

function validDateOrNull(value: unknown): string | null {
  const text = nullableString(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function portalStatusSource(value: unknown): PortalActiveDealRow["portal_status"]["source"] {
  return value === "quote_review" ||
    value === "deal_progress" ||
    value === "service_job" ||
    value === "portal_request" ||
    value === "default"
    ? value
    : "default";
}

function portalServiceStatusSource(value: unknown): NonNullable<PortalServiceRequestRow["portal_status"]>["source"] {
  return value === "service_job" || value === "portal_request" || value === "default" ? value : "default";
}

function normalizeActiveDealStatus(value: unknown): PortalActiveDealRow["portal_status"] {
  const status = firstRecord(value);
  return {
    label: stringValue(status?.label, "In progress"),
    source: portalStatusSource(status?.source),
    source_label: stringValue(status?.source_label, "Portal status"),
    eta: validDateOrNull(status?.eta),
    last_updated_at: validDateOrNull(status?.last_updated_at),
    next_action: nullableString(status?.next_action),
  };
}

export function normalizePortalActiveDeals(rows: unknown): PortalActiveDealRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const dealId = nullableString(value.deal_id);
    const dealName = nullableString(value.deal_name);
    if (!dealId || !dealName) return [];
    return [{
      deal_id: dealId,
      deal_name: dealName,
      amount: numberValue(value.amount),
      expected_close_on: validDateOrNull(value.expected_close_on),
      next_follow_up_at: validDateOrNull(value.next_follow_up_at),
      quote_review_id: nullableString(value.quote_review_id),
      quote_review_status: nullableString(value.quote_review_status),
      portal_status: normalizeActiveDealStatus(value.portal_status),
    }];
  });
}

export function normalizePortalFleetItems(rows: unknown): PortalFleetItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePortalFleetItem).filter((row): row is PortalFleetItem => row !== null);
}

export function normalizePortalFleetPickerRows(rows: unknown): PortalFleetPickerRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = nullableString(value.id);
    if (!id) return [];
    return [{
      id,
      make: stringValue(value.make, "Equipment"),
      model: stringValue(value.model, ""),
      year: numberValue(value.year),
      serial_number: nullableString(value.serial_number),
    }];
  });
}

function normalizePortalFleetItem(value: unknown): PortalFleetItem | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  if (!id) return null;
  return {
    id,
    name: stringValue(value.name, "Equipment"),
    make: nullableString(value.make),
    model: nullableString(value.model),
    year: numberValue(value.year),
    engine_hours: numberValue(value.engine_hours),
    stage_label: nullableString(value.stage_label),
    last_lat: numberValue(value.last_lat),
    last_lng: numberValue(value.last_lng),
  };
}

export function normalizePortalFleetDetailItems(rows: unknown): PortalFleetDetailItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePortalFleetDetailItem).filter((row): row is PortalFleetDetailItem => row !== null);
}

function normalizePortalFleetDetailItem(value: unknown): PortalFleetDetailItem | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  if (!id) return null;
  const status = firstRecord(value.portal_status);
  return {
    id,
    equipment_id: nullableString(value.equipment_id),
    make: nullableString(value.make),
    model: nullableString(value.model),
    name: nullableString(value.name),
    year: numberValue(value.year),
    serial_number: nullableString(value.serial_number),
    current_hours: numberValue(value.current_hours),
    warranty_expiry: nullableString(value.warranty_expiry),
    next_service_due: nullableString(value.next_service_due),
    trade_in_interest: value.trade_in_interest === true,
    portal_status: status
      ? {
          label: stringValue(status.label, "Status"),
          source_label: stringValue(status.source_label, "Portal status"),
          eta: nullableString(status.eta),
          last_updated_at: nullableString(status.last_updated_at),
        }
      : null,
    maintenance_schedules: normalizePortalMaintenanceScheduleRows(value.maintenance_schedules),
  };
}

function normalizePortalMaintenanceScheduleRows(rows: unknown): PortalMaintenanceScheduleRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value): PortalMaintenanceScheduleRow | null => {
    if (!isRecord(value)) return null;
    const id = nullableString(value.id);
    if (!id) return null;
    return {
      id,
      label: nullableString(value.label),
      next_due_date: nullableString(value.next_due_date),
      next_due_hours: numberValue(value.next_due_hours),
    };
  }).filter((row): row is PortalMaintenanceScheduleRow => row !== null);
}

export function normalizeEquipmentDocuments(rows: unknown): EquipmentDocument[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeEquipmentDocument).filter((row): row is EquipmentDocument => row !== null);
}

function normalizeEquipmentDocument(value: unknown): EquipmentDocument | null {
  if (!isRecord(value)) return null;
  const id = nullableString(value.id);
  const title = nullableString(value.title);
  const fileUrl = nullableString(value.file_url);
  const createdAt = nullableString(value.created_at);
  if (!id || !title || !fileUrl || !createdAt) return null;
  const visibility = firstRecord(value.portal_visibility);
  return {
    id,
    fleet_id: nullableString(value.fleet_id),
    crm_equipment_id: nullableString(value.crm_equipment_id),
    document_type: documentType(value.document_type),
    title,
    description: nullableString(value.description),
    file_url: fileUrl,
    file_size_bytes: numberValue(value.file_size_bytes),
    mime_type: nullableString(value.mime_type),
    customer_visible: value.customer_visible === true,
    created_at: createdAt,
    portal_visibility: visibility
      ? {
          label: stringValue(visibility.label),
          detail: stringValue(visibility.detail),
          released_at: stringValue(visibility.released_at),
        }
      : null,
  };
}

export function normalizeMachineHistoryRows(rows: unknown): MachineHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeMachineHistoryRow).filter((row): row is MachineHistoryRow => row !== null);
}

function normalizeMachineHistoryRow(value: unknown): MachineHistoryRow | null {
  if (!isRecord(value)) return null;
  const fleetId = nullableString(value.fleet_id);
  if (!fleetId) return null;
  return {
    fleet_id: fleetId,
    make: nullableString(value.make),
    model: nullableString(value.model),
    year: numberValue(value.year),
    serial_number: nullableString(value.serial_number),
    last_ordered_at: nullableString(value.last_ordered_at),
    total_orders: numberValue(value.total_orders) ?? 0,
    recent_line_items: normalizeRecentOrderEntries(value.recent_line_items),
  };
}

function normalizeRecentOrderEntries(rows: unknown): MachineHistoryRow["recent_line_items"] {
  if (!Array.isArray(rows)) return null;
  return rows.map((value) => {
    if (!isRecord(value)) return null;
    const createdAt = nullableString(value.created_at);
    if (!createdAt) return null;
    const lineItems = Array.isArray(value.li)
      ? value.li.map(normalizeRecentLineItem).filter((row): row is RecentLineItem => row !== null)
      : normalizeRecentLineItem(value.li);
    if (Array.isArray(lineItems) && lineItems.length === 0) return null;
    if (!Array.isArray(lineItems) && lineItems === null) return null;
    return {
      li: lineItems,
      created_at: createdAt,
    };
  }).filter((row): row is NonNullable<MachineHistoryRow["recent_line_items"]>[number] => row !== null);
}

function normalizeRecentLineItem(value: unknown): RecentLineItem | null {
  if (!isRecord(value)) return null;
  const partNumber = nullableString(value.part_number);
  if (!partNumber) return null;
  const quantity = numberValue(value.quantity);
  const description = nullableString(value.description);
  const unitPrice = numberValue(value.unit_price);
  return {
    part_number: partNumber,
    ...(quantity !== null ? { quantity } : {}),
    ...(description ? { description } : {}),
    ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
  };
}

function normalizeInvoiceLineItems(value: unknown): PortalInvoiceLineItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const description = nullableString(row.description);
    const id = nullableString(row.id);
    if (!description && !id) return [];
    return [{
      ...(id ? { id } : {}),
      ...(description ? { description } : {}),
      ...(numberValue(row.quantity) != null ? { quantity: numberValue(row.quantity)! } : {}),
      ...(numberValue(row.unit_price) != null ? { unit_price: numberValue(row.unit_price)! } : {}),
      ...(numberValue(row.line_total) != null ? { line_total: numberValue(row.line_total)! } : {}),
    }];
  });
}

function normalizePaymentHistory(value: unknown): PortalInvoicePaymentHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const label = nullableString(row.label);
    if (!label) return [];
    const status = row.status === "pending" || row.status === "processing" || row.status === "paid" || row.status === "failed"
      ? row.status
      : "pending";
    return [{
      label,
      detail: stringValue(row.detail),
      amount: numberValue(row.amount) ?? 0,
      status,
      reference: nullableString(row.reference),
      created_at: validDateOrNull(row.created_at) ?? "",
      resolved_at: validDateOrNull(row.resolved_at),
    }];
  });
}

function normalizeInvoiceTimeline(value: unknown): PortalInvoiceTimelineItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const label = nullableString(row.label);
    if (!label) return [];
    return [{
      label,
      detail: stringValue(row.detail),
      at: validDateOrNull(row.at),
      tone: stringValue(row.tone, "blue"),
    }];
  });
}

export function normalizePortalInvoiceRecord(value: unknown): PortalInvoiceRecord | null {
  if (!isRecord(value)) return null;
  return {
    ...value,
    customer_invoice_line_items: normalizeInvoiceLineItems(value.customer_invoice_line_items),
    portal_payment_history: normalizePaymentHistory(value.portal_payment_history),
    portal_invoice_timeline: normalizeInvoiceTimeline(value.portal_invoice_timeline),
  };
}

function normalizeServicePortalStatus(value: unknown): PortalServiceRequestRow["portal_status"] {
  const status = firstRecord(value);
  if (!status) return null;
  return {
    label: stringValue(status.label, "Status"),
    source: portalServiceStatusSource(status.source),
    source_label: stringValue(status.source_label, "Portal status"),
    eta: validDateOrNull(status.eta),
    last_updated_at: validDateOrNull(status.last_updated_at),
  };
}

function normalizeServiceTimeline(value: unknown): PortalServiceRequestRow["workspace_timeline"] {
  const timeline = firstRecord(value);
  if (!timeline) return null;
  return {
    branch_label: nullableString(timeline.branch_label),
    next_step: nullableString(timeline.next_step),
    customer_summary: nullableString(timeline.customer_summary),
  };
}

function normalizeInternalJob(value: unknown): PortalServiceRequestRow["internal_job"] {
  const job = firstRecord(value);
  if (!job) return null;
  const id = nullableString(job.id);
  if (!id) return null;
  return {
    id,
    current_stage: nullableString(job.current_stage),
    closed_at: validDateOrNull(job.closed_at),
  };
}

function normalizePortalServiceRows(rows: unknown): PortalServiceRequestRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = nullableString(value.id);
    if (!id) return [];
    return [{
      ...value,
      id,
      request_type: stringValue(value.request_type, "service"),
      description: stringValue(value.description, "Service request"),
      status: stringValue(value.status, "open"),
      portal_status: normalizeServicePortalStatus(value.portal_status),
      internal_job: normalizeInternalJob(value.internal_job),
      workspace_timeline: normalizeServiceTimeline(value.workspace_timeline),
      photo_count: numberValue(value.photo_count) ?? 0,
    }];
  });
}

export function normalizePortalServiceRequestsPayload(payload: unknown): PortalServiceRequestsPayload {
  const record = isRecord(payload) ? payload : {};
  const summary = firstRecord(record.workspace_summary);
  return {
    open_requests: normalizePortalServiceRows(record.open_requests ?? record.requests),
    completed_requests: normalizePortalServiceRows(record.completed_requests),
    blocked_requests: normalizePortalServiceRows(record.blocked_requests),
    workspace_summary: summary
      ? {
          open_count: numberValue(summary.open_count) ?? 0,
          completed_count: numberValue(summary.completed_count) ?? 0,
          blocked_count: numberValue(summary.blocked_count) ?? 0,
        }
      : null,
  };
}

export function normalizePortalServiceTimelinePayload(payload: unknown): PortalServiceTimelinePayload {
  const record = isRecord(payload) ? payload : {};
  return {
    ok: record.ok === true,
    service_job_id: nullableString(record.service_job_id),
    events: Array.isArray(record.events)
      ? record.events.flatMap((event) => {
          if (!isRecord(event)) return [];
          const id = nullableString(event.id);
          const eventType = nullableString(event.event_type);
          const createdAt = validDateOrNull(event.created_at);
          const customerLabel = nullableString(event.customer_label);
          if (!id || !eventType || !createdAt || !customerLabel) return [];
          return [{
            id,
            event_type: eventType,
            created_at: createdAt,
            new_stage: nullableString(event.new_stage),
            customer_label: customerLabel,
          }];
        })
      : [],
  };
}

function normalizeMatchedJobCode(value: unknown): NonNullable<PortalPmKitSuggestion["matched_job_code"]> | undefined {
  if (!isRecord(value)) return undefined;
  const id = nullableString(value.id);
  const jobName = nullableString(value.job_name);
  const make = nullableString(value.make);
  if (!id || !jobName || !make) return undefined;
  return {
    id,
    job_name: jobName,
    make,
    model_family: nullableString(value.model_family),
  };
}

export function normalizePortalPmKitSuggestion(payload: unknown): PortalPmKitSuggestion {
  const record = isRecord(payload) ? payload : {};
  const matchedJobCode = normalizeMatchedJobCode(record.matched_job_code);
  if (record.ok !== true) {
    return {
      ok: false,
      error: stringValue(record.error, "no_match"),
      message: stringValue(record.message, "No PM kit suggestion is available for this machine."),
      ...(matchedJobCode ? { matched_job_code: matchedJobCode } : {}),
    };
  }

  return {
    ok: true,
    ai_suggested_pm_kit: record.ai_suggested_pm_kit === true,
    ai_suggestion_reason: stringValue(record.ai_suggestion_reason),
    line_items: Array.isArray(record.line_items)
      ? record.line_items.flatMap((line) => {
          if (!isRecord(line)) return [];
          const partNumber = nullableString(line.part_number);
          if (!partNumber) return [];
          return [{
            part_number: partNumber,
            quantity: Math.max(1, numberValue(line.quantity) ?? 1),
            ...(nullableString(line.description) ? { description: nullableString(line.description)! } : {}),
            ...(line.is_ai_suggested === true ? { is_ai_suggested: true } : {}),
          }];
        })
      : [],
    matched_job_code: matchedJobCode ?? { id: "unknown", job_name: "PM kit", make: "Equipment", model_family: null },
  };
}

export function getCreatedPortalOrderId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return nullableString(firstRecord(payload.order)?.id);
}

export function normalizePortalCheckoutResponse(payload: unknown): PortalCheckoutResponse {
  const record = isRecord(payload) ? payload : {};
  return {
    url: nullableString(record.url) ?? undefined,
    fallback: nullableString(record.fallback) ?? undefined,
    stripe_configured: record.stripe_configured === true,
    stripe_error: record.stripe_error === true ? true : undefined,
    message: nullableString(record.message) ?? undefined,
  };
}

export function getPortalErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return nullableString(payload.error) ?? nullableString(payload.message);
}
