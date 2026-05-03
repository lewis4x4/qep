import type { ServiceJobWithRelations, ServiceListResponse } from "./types";

export type PartsPopulateResult = { populated: number };
export type BillingPostResult = {
  ok?: boolean;
  customer_invoice_id?: string;
  lines_posted?: number;
  invoice_total?: number;
  error?: string;
};
export type ResyncPartsResult = { inserted: number; cancelled: number; mode: string };
export type ReassignFromBranchPoolResult = { reassigned: number; replacement: string };
export type CalendarSlotsResult = { slots: string[]; slot_minutes: number; branch_id: string };

export type PortalOrderSearchRow = {
  id: string;
  status: string;
  fulfillment_run_id: string | null;
  created_at: string;
  portal_customers: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
};

export type LinkFulfillmentRunPayload = {
  job: ServiceJobWithRelations | null;
  error: string | null;
  code: string | null;
  other_job_ids: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

export function isServiceJobWithRelations(value: unknown): value is ServiceJobWithRelations {
  if (!isRecord(value)) return false;
  return Boolean(
    requiredString(value.id) &&
      requiredString(value.workspace_id) &&
      requiredString(value.current_stage) &&
      requiredString(value.tracking_token) &&
      requiredString(value.created_at) &&
      requiredString(value.updated_at),
  );
}

export function normalizeServiceJobResponse(value: unknown): ServiceJobWithRelations {
  if (!isRecord(value) || !isServiceJobWithRelations(value.job)) {
    throw new Error("Service router returned a malformed job payload.");
  }
  return value.job;
}

export function normalizeServiceListResponse(value: unknown): ServiceListResponse {
  if (!isRecord(value)) {
    return { jobs: [], total: 0, page: 1, per_page: 0 };
  }
  return {
    jobs: Array.isArray(value.jobs) ? value.jobs.filter(isServiceJobWithRelations) : [],
    total: numberOrNull(value.total) ?? 0,
    page: numberOrNull(value.page) ?? 1,
    per_page: numberOrNull(value.per_page) ?? 0,
  };
}

export function normalizePartsPopulateResult(value: unknown): PartsPopulateResult {
  if (!isRecord(value)) return { populated: 0 };
  return { populated: numberOrNull(value.populated) ?? 0 };
}

export function normalizeBillingPostResult(value: unknown): BillingPostResult {
  if (!isRecord(value)) return {};
  return {
    ok: typeof value.ok === "boolean" ? value.ok : undefined,
    customer_invoice_id: stringOrNull(value.customer_invoice_id) ?? undefined,
    lines_posted: numberOrNull(value.lines_posted) ?? undefined,
    invoice_total: numberOrNull(value.invoice_total) ?? undefined,
    error: stringOrNull(value.error) ?? undefined,
  };
}

export function normalizeResyncPartsResult(value: unknown): ResyncPartsResult {
  if (!isRecord(value)) return { inserted: 0, cancelled: 0, mode: "unknown" };
  return {
    inserted: numberOrNull(value.inserted) ?? 0,
    cancelled: numberOrNull(value.cancelled) ?? 0,
    mode: stringOrNull(value.mode) ?? "unknown",
  };
}

export function normalizeReassignFromBranchPoolResult(value: unknown): ReassignFromBranchPoolResult {
  if (!isRecord(value)) return { reassigned: 0, replacement: "" };
  return {
    reassigned: numberOrNull(value.reassigned) ?? 0,
    replacement: stringOrNull(value.replacement) ?? "",
  };
}

function normalizePortalCustomer(value: unknown): PortalOrderSearchRow["portal_customers"] {
  const row = firstRecord(value);
  if (!row) return null;
  const firstName = requiredString(row.first_name);
  const lastName = requiredString(row.last_name);
  const email = requiredString(row.email);
  return firstName && lastName && email
    ? { first_name: firstName, last_name: lastName, email }
    : null;
}

export function normalizePortalOrderSearchRows(rows: unknown): PortalOrderSearchRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const status = requiredString(value.status);
    const createdAt = requiredString(value.created_at);
    if (!id || !status || !createdAt) return [];
    return [{
      id,
      status,
      fulfillment_run_id: stringOrNull(value.fulfillment_run_id),
      created_at: createdAt,
      portal_customers: normalizePortalCustomer(value.portal_customers),
    }];
  });
}

export function normalizeSearchPortalOrdersResponse(value: unknown): PortalOrderSearchRow[] {
  if (!isRecord(value)) return [];
  return normalizePortalOrderSearchRows(value.orders);
}

export function normalizeLinkFulfillmentRunPayload(value: unknown): LinkFulfillmentRunPayload {
  if (!isRecord(value)) {
    return { job: null, error: null, code: null, other_job_ids: [] };
  }
  return {
    job: isServiceJobWithRelations(value.job) ? value.job : null,
    error: stringOrNull(value.error),
    code: stringOrNull(value.code),
    other_job_ids: stringArray(value.other_job_ids),
  };
}

export function normalizeCalendarSlotsResult(value: unknown): CalendarSlotsResult {
  if (!isRecord(value)) {
    return { slots: [], slot_minutes: 0, branch_id: "" };
  }
  return {
    slots: stringArray(value.slots),
    slot_minutes: numberOrNull(value.slot_minutes) ?? 0,
    branch_id: stringOrNull(value.branch_id) ?? "",
  };
}
