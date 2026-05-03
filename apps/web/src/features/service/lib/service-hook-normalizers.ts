export interface CustomerResult {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
}

export interface EquipmentResult {
  id: string;
  make: string;
  model: string;
  serial_number: string;
  year: number | null;
  customer_id: string | null;
}

export interface PartsQueueItem {
  id: string;
  job_id: string;
  part_number: string;
  description: string | null;
  quantity: number;
  status: string;
  need_by_date: string | null;
  confidence: string;
  vendor_id: string | null;
  /** Lines still in job-code / AI suggestion state are excluded so the queue matches the parts planner. */
  intake_line_status?: string;
  job?: {
    id: string;
    fulfillment_run_id: string | null;
    customer_problem_summary: string | null;
    priority: string;
    status_flags: string[];
    customer: { id: string; name: string } | null;
    machine: { id: string; make: string; model: string; serial_number: string } | null;
  };
  actions?: {
    id: string;
    action_type: string;
    completed_at: string | null;
    expected_date: string | null;
    po_reference: string | null;
  }[];
  staging?: { bin_location: string | null; staged_at: string }[];
}

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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeCustomerResults(rows: unknown): CustomerResult[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const name = requiredString(value.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      phone: stringOrNull(value.phone),
      city: stringOrNull(value.city),
      state: stringOrNull(value.state),
    }];
  });
}

export function normalizeEquipmentResults(rows: unknown): EquipmentResult[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const make = requiredString(value.make);
    const model = requiredString(value.model);
    const serialNumber = requiredString(value.serial_number);
    if (!id || !make || !model || !serialNumber) return [];
    return [{
      id,
      make,
      model,
      serial_number: serialNumber,
      year: numberOrNull(value.year),
      customer_id: stringOrNull(value.customer_id) ?? stringOrNull(value.company_id),
    }];
  });
}

function normalizePartsQueueCustomer(value: unknown): NonNullable<PartsQueueItem["job"]>["customer"] {
  const row = firstRecord(value);
  if (!row) return null;
  const id = requiredString(row.id);
  const name = requiredString(row.name);
  return id && name ? { id, name } : null;
}

function normalizePartsQueueMachine(value: unknown): NonNullable<PartsQueueItem["job"]>["machine"] {
  const row = firstRecord(value);
  if (!row) return null;
  const id = requiredString(row.id);
  const make = requiredString(row.make);
  const model = requiredString(row.model);
  const serialNumber = requiredString(row.serial_number);
  return id && make && model && serialNumber ? { id, make, model, serial_number: serialNumber } : null;
}

function normalizePartsQueueJob(value: unknown): PartsQueueItem["job"] {
  const row = firstRecord(value);
  if (!row) return undefined;
  const id = requiredString(row.id);
  const priority = requiredString(row.priority);
  if (!id || !priority) return undefined;
  return {
    id,
    fulfillment_run_id: stringOrNull(row.fulfillment_run_id),
    customer_problem_summary: stringOrNull(row.customer_problem_summary),
    priority,
    status_flags: stringArray(row.status_flags),
    customer: normalizePartsQueueCustomer(row.customer),
    machine: normalizePartsQueueMachine(row.machine),
  };
}

function normalizePartsQueueActions(value: unknown): NonNullable<PartsQueueItem["actions"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = requiredString(item.id);
    const actionType = requiredString(item.action_type);
    if (!id || !actionType) return [];
    return [{
      id,
      action_type: actionType,
      completed_at: stringOrNull(item.completed_at),
      expected_date: stringOrNull(item.expected_date),
      po_reference: stringOrNull(item.po_reference),
    }];
  });
}

function normalizePartsQueueStaging(value: unknown): NonNullable<PartsQueueItem["staging"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const stagedAt = requiredString(item.staged_at);
    if (!stagedAt) return [];
    return [{
      bin_location: stringOrNull(item.bin_location),
      staged_at: stagedAt,
    }];
  });
}

export function normalizePartsQueueItems(rows: unknown): PartsQueueItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const jobId = requiredString(value.job_id);
    const partNumber = requiredString(value.part_number);
    const quantity = numberOrNull(value.quantity);
    const status = requiredString(value.status);
    const confidence = requiredString(value.confidence);
    if (!id || !jobId || !partNumber || quantity == null || !status || !confidence) return [];
    return [{
      id,
      job_id: jobId,
      part_number: partNumber,
      description: stringOrNull(value.description),
      quantity,
      status,
      need_by_date: stringOrNull(value.need_by_date),
      confidence,
      vendor_id: stringOrNull(value.vendor_id),
      intake_line_status: stringOrNull(value.intake_line_status) ?? undefined,
      job: normalizePartsQueueJob(value.job),
      actions: normalizePartsQueueActions(value.actions),
      staging: normalizePartsQueueStaging(value.staging),
    }];
  }).filter((item) => (item.intake_line_status ?? "accepted") !== "suggested");
}
