import { SERVICE_STAGES, type ServiceStage } from "./constants";
import type {
  ServiceJobWithRelations,
  ServicePriority,
  ServiceRequestType,
  ServiceSourceType,
  ServiceStatusFlag,
} from "./types";

export type ServiceWipAgingBucket = "current" | "31_60" | "61_90" | "91_120" | "over_120";
export type ServiceWipBillingStatus = "customer" | "warranty" | "internal";

export type ServiceCronRun = {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  error: string | null;
  metadata: Record<string, unknown>;
};

export type ServiceWipSummaryRow = {
  workspace_id: string;
  branch_id: string | null;
  billing_status: ServiceWipBillingStatus;
  aging_bucket: ServiceWipAgingBucket;
  job_count: number;
  total_value: number;
  avg_stage_hours: number;
};

export type ServiceDashboardRollupRow = {
  workspace_id: string;
  branch_id: string | null;
  overdue_count: number;
  pending_count: number;
  active_count: number;
  closed_count: number;
  total_count: number;
};

export type ServiceDashboardJobRow = {
  id: string;
  customer_id: string | null;
  machine_id: string | null;
  current_stage: string;
  scheduled_end_at: string | null;
  customer_problem_summary: string | null;
  branch_id: string | null;
  technician_id: string | null;
  invoice_total: number | null;
  customer_name?: string | null;
  open_deal_value?: number | null;
  trade_up_score?: number | null;
};

const WIP_AGING_BUCKETS = new Set<ServiceWipAgingBucket>(["current", "31_60", "61_90", "91_120", "over_120"]);
const WIP_BILLING_STATUSES = new Set<ServiceWipBillingStatus>(["customer", "warranty", "internal"]);
const SERVICE_STAGE_VALUES = new Set<ServiceStage>(SERVICE_STAGES);
const SERVICE_SOURCE_TYPES = new Set<ServiceSourceType>(["call", "walk_in", "field_tech", "sales_handoff", "portal"]);
const SERVICE_REQUEST_TYPES = new Set<ServiceRequestType>([
  "repair",
  "pm_service",
  "inspection",
  "machine_down",
  "recall",
  "warranty",
]);
const SERVICE_PRIORITIES = new Set<ServicePriority>(["normal", "urgent", "critical"]);
const SERVICE_STATUS_FLAGS = new Set<ServiceStatusFlag>([
  "machine_down",
  "shop_job",
  "field_job",
  "internal",
  "warranty_recall",
  "customer_pay",
  "good_faith",
  "waiting_customer",
  "waiting_vendor",
  "waiting_transfer",
  "waiting_haul",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  const normalized = stringOrNull(value)?.trim();
  return normalized ? normalized : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function requiredNumber(value: unknown): number | null {
  return numberOrNull(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function serviceStatusFlags(value: unknown): ServiceStatusFlag[] {
  return stringArray(value).filter((flag): flag is ServiceStatusFlag => SERVICE_STATUS_FLAGS.has(flag as ServiceStatusFlag));
}

function serviceStageOrNull(value: unknown): ServiceStage | null {
  return typeof value === "string" && SERVICE_STAGE_VALUES.has(value as ServiceStage) ? value as ServiceStage : null;
}

function sourceTypeOrNull(value: unknown): ServiceSourceType | null {
  return typeof value === "string" && SERVICE_SOURCE_TYPES.has(value as ServiceSourceType)
    ? value as ServiceSourceType
    : null;
}

function requestTypeOrNull(value: unknown): ServiceRequestType | null {
  return typeof value === "string" && SERVICE_REQUEST_TYPES.has(value as ServiceRequestType)
    ? value as ServiceRequestType
    : null;
}

function priorityOrNull(value: unknown): ServicePriority | null {
  return typeof value === "string" && SERVICE_PRIORITIES.has(value as ServicePriority)
    ? value as ServicePriority
    : null;
}

function wipBillingStatusOrNull(value: unknown): ServiceWipBillingStatus | null {
  return typeof value === "string" && WIP_BILLING_STATUSES.has(value as ServiceWipBillingStatus)
    ? value as ServiceWipBillingStatus
    : null;
}

function wipAgingBucketOrNull(value: unknown): ServiceWipAgingBucket | null {
  return typeof value === "string" && WIP_AGING_BUCKETS.has(value as ServiceWipAgingBucket)
    ? value as ServiceWipAgingBucket
    : null;
}

function normalizeJoinedCustomer(value: unknown): ServiceJobWithRelations["customer"] {
  const row = firstRecord(value);
  if (!row) return null;
  const id = requiredString(row.id);
  const name = requiredString(row.name);
  return id && name ? { id, name } : null;
}

function normalizeJoinedMachine(value: unknown): ServiceJobWithRelations["machine"] {
  const row = firstRecord(value);
  if (!row) return null;
  const id = requiredString(row.id);
  const make = stringOrNull(row.make) ?? "";
  const model = stringOrNull(row.model) ?? "";
  const serialNumber = stringOrNull(row.serial_number) ?? "";
  const year = numberOrNull(row.year) ?? 0;
  return id ? { id, make, model, serial_number: serialNumber, year } : null;
}

export function normalizeServiceCronRunRows(rows: unknown): ServiceCronRun[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const jobName = requiredString(value.job_name);
    const startedAt = requiredString(value.started_at);
    if (!id || !jobName || !startedAt || typeof value.ok !== "boolean") return [];
    return [{
      id,
      job_name: jobName,
      started_at: startedAt,
      finished_at: stringOrNull(value.finished_at),
      ok: value.ok,
      error: stringOrNull(value.error),
      metadata: recordOrEmpty(value.metadata),
    }];
  });
}

export function normalizeServiceWipSummaryRows(rows: unknown): ServiceWipSummaryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const workspaceId = requiredString(value.workspace_id);
    const billingStatus = wipBillingStatusOrNull(value.billing_status);
    const agingBucket = wipAgingBucketOrNull(value.aging_bucket);
    const jobCount = requiredNumber(value.job_count);
    const totalValue = requiredNumber(value.total_value);
    const avgStageHours = requiredNumber(value.avg_stage_hours);
    if (!workspaceId || !billingStatus || !agingBucket || jobCount == null || totalValue == null || avgStageHours == null) {
      return [];
    }
    return [{
      workspace_id: workspaceId,
      branch_id: stringOrNull(value.branch_id),
      billing_status: billingStatus,
      aging_bucket: agingBucket,
      job_count: jobCount,
      total_value: totalValue,
      avg_stage_hours: avgStageHours,
    }];
  });
}

export function normalizeServiceWipJobRows(rows: unknown): ServiceJobWithRelations[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const workspaceId = requiredString(value.workspace_id);
    const sourceType = sourceTypeOrNull(value.source_type);
    const requestType = requestTypeOrNull(value.request_type);
    const priority = priorityOrNull(value.priority);
    const currentStage = serviceStageOrNull(value.current_stage);
    const trackingToken = requiredString(value.tracking_token);
    const createdAt = requiredString(value.created_at);
    const updatedAt = requiredString(value.updated_at);
    if (!id || !workspaceId || !sourceType || !requestType || !priority || !currentStage || !trackingToken || !createdAt || !updatedAt) {
      return [];
    }
    return [{
      id,
      workspace_id: workspaceId,
      customer_id: stringOrNull(value.customer_id),
      contact_id: stringOrNull(value.contact_id),
      machine_id: stringOrNull(value.machine_id),
      source_type: sourceType,
      request_type: requestType,
      priority,
      current_stage: currentStage,
      status_flags: serviceStatusFlags(value.status_flags),
      branch_id: stringOrNull(value.branch_id),
      advisor_id: stringOrNull(value.advisor_id),
      service_manager_id: stringOrNull(value.service_manager_id),
      technician_id: stringOrNull(value.technician_id),
      requested_by_name: stringOrNull(value.requested_by_name),
      customer_problem_summary: stringOrNull(value.customer_problem_summary),
      ai_diagnosis_summary: stringOrNull(value.ai_diagnosis_summary),
      selected_job_code_id: stringOrNull(value.selected_job_code_id),
      haul_required: typeof value.haul_required === "boolean" ? value.haul_required : false,
      shop_or_field: value.shop_or_field === "field" ? "field" : "shop",
      scheduled_start_at: stringOrNull(value.scheduled_start_at),
      scheduled_end_at: stringOrNull(value.scheduled_end_at),
      quote_total: numberOrNull(value.quote_total),
      invoice_total: numberOrNull(value.invoice_total),
      portal_request_id: stringOrNull(value.portal_request_id),
      fulfillment_run_id: stringOrNull(value.fulfillment_run_id),
      tracking_token: trackingToken,
      created_at: createdAt,
      updated_at: updatedAt,
      closed_at: stringOrNull(value.closed_at),
      deleted_at: stringOrNull(value.deleted_at),
      customer: normalizeJoinedCustomer(value.customer),
      machine: normalizeJoinedMachine(value.machine),
    }];
  });
}

export function normalizeServiceDashboardRollupRows(rows: unknown): ServiceDashboardRollupRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const workspaceId = requiredString(value.workspace_id);
    if (!workspaceId) return [];
    return [{
      workspace_id: workspaceId,
      branch_id: stringOrNull(value.branch_id),
      overdue_count: numberOrNull(value.overdue_count) ?? 0,
      pending_count: numberOrNull(value.pending_count) ?? 0,
      active_count: numberOrNull(value.active_count) ?? 0,
      closed_count: numberOrNull(value.closed_count) ?? 0,
      total_count: numberOrNull(value.total_count) ?? 0,
    }];
  });
}

export function normalizeServiceDashboardOverdueRows(rows: unknown): ServiceDashboardJobRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const currentStage = requiredString(value.current_stage);
    if (!id || !currentStage) return [];
    return [{
      id,
      customer_id: stringOrNull(value.customer_id),
      machine_id: stringOrNull(value.machine_id),
      current_stage: currentStage,
      scheduled_end_at: stringOrNull(value.scheduled_end_at),
      customer_problem_summary: stringOrNull(value.customer_problem_summary),
      branch_id: stringOrNull(value.branch_id),
      technician_id: stringOrNull(value.technician_id),
      invoice_total: numberOrNull(value.invoice_total),
      customer_name: stringOrNull(value.customer_name),
      open_deal_value: numberOrNull(value.open_deal_value),
      trade_up_score: numberOrNull(value.trade_up_score),
    }];
  });
}

export function getServiceWipBillingStatus(
  job: Pick<ServiceJobWithRelations, "status_flags">,
): ServiceWipBillingStatus {
  const flags = job.status_flags ?? [];
  if (flags.includes("internal")) return "internal";
  if (flags.includes("warranty_recall")) return "warranty";
  return "customer";
}

export function getServiceWipAgingBucket(
  createdAt: string,
  now = new Date(),
): ServiceWipAgingBucket {
  const created = new Date(createdAt);
  const ageDays = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
  if (ageDays <= 30) return "current";
  if (ageDays <= 60) return "31_60";
  if (ageDays <= 90) return "61_90";
  if (ageDays <= 120) return "91_120";
  return "over_120";
}

export function getServiceWipValue(
  job: Pick<ServiceJobWithRelations, "invoice_total" | "quote_total">,
): number {
  return Number(job.invoice_total ?? job.quote_total ?? 0);
}

export function matchesServiceWipFilters(
  job: ServiceJobWithRelations,
  search: string,
  billingStatus: ServiceWipBillingStatus | "all",
  agingBucket: ServiceWipAgingBucket | "all",
  now = new Date(),
): boolean {
  if (billingStatus !== "all" && getServiceWipBillingStatus(job) !== billingStatus) return false;
  if (agingBucket !== "all" && getServiceWipAgingBucket(job.created_at, now) !== agingBucket) return false;

  const needle = search.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    job.customer?.name,
    job.machine?.serial_number,
    job.machine?.make,
    job.machine?.model,
    job.customer_problem_summary,
    job.branch_id,
    job.current_stage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}
