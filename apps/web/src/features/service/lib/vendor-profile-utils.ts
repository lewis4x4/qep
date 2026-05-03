export const VENDOR_SUPPLIER_TYPES = ["oem", "aftermarket", "general", "specialty", "internal"] as const;
export type VendorSupplierType = typeof VENDOR_SUPPLIER_TYPES[number];

export type VendorRow = {
  id: string;
  name: string;
  supplier_type: VendorSupplierType;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  notes: string | null;
};

export type VendorPolicyRow = {
  id: string;
  name: string;
  steps: unknown;
  is_machine_down: boolean;
};

export type VendorPriceRow = {
  id: string;
  vendor_id: string;
  part_number: string;
  description: string | null;
  list_price: number | null;
  currency: string;
  effective_date: string;
};

export type VendorSubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export type VendorSubmissionRow = {
  id: string;
  vendor_id: string;
  part_number: string;
  description: string | null;
  proposed_list_price: number;
  currency: string;
  effective_date: string;
  submission_notes: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  status: VendorSubmissionStatus;
  review_notes: string | null;
  reviewed_at: string | null;
  vendor_profiles?: { name?: string } | { name?: string }[] | null;
};

export type VendorAccessKeyRow = {
  id: string;
  vendor_id: string;
  label: string | null;
  contact_name: string | null;
  contact_email: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  vendor_profiles?: { name?: string } | { name?: string }[] | null;
};

const SUPPLIER_TYPE_SET = new Set<VendorSupplierType>(VENDOR_SUPPLIER_TYPES);
const SUBMISSION_STATUSES = new Set<VendorSubmissionStatus>(["pending", "approved", "rejected", "withdrawn"]);

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

function supplierType(value: unknown): VendorSupplierType {
  return typeof value === "string" && SUPPLIER_TYPE_SET.has(value as VendorSupplierType)
    ? value as VendorSupplierType
    : "general";
}

function submissionStatusOrNull(value: unknown): VendorSubmissionStatus | null {
  return typeof value === "string" && SUBMISSION_STATUSES.has(value as VendorSubmissionStatus)
    ? value as VendorSubmissionStatus
    : null;
}

function joinedVendor(value: unknown): { name?: string } | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  const name = requiredString(row.name);
  return name ? { name } : null;
}

export function joinedVendorName(value: VendorSubmissionRow["vendor_profiles"] | VendorAccessKeyRow["vendor_profiles"]): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? "Vendor";
}

export function normalizeVendorRows(rows: unknown): VendorRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const name = requiredString(value.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      supplier_type: supplierType(value.supplier_type),
      avg_lead_time_hours: numberOrNull(value.avg_lead_time_hours),
      responsiveness_score: numberOrNull(value.responsiveness_score),
      notes: stringOrNull(value.notes),
    }];
  });
}

export function normalizeVendorPolicyRows(rows: unknown): VendorPolicyRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const name = requiredString(value.name);
    if (!id || !name || typeof value.is_machine_down !== "boolean") return [];
    return [{
      id,
      name,
      steps: value.steps,
      is_machine_down: value.is_machine_down,
    }];
  });
}

export function normalizeVendorAccessKeyRows(rows: unknown): VendorAccessKeyRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const vendorId = requiredString(value.vendor_id);
    const createdAt = requiredString(value.created_at);
    if (!id || !vendorId || !createdAt) return [];
    return [{
      id,
      vendor_id: vendorId,
      label: stringOrNull(value.label),
      contact_name: stringOrNull(value.contact_name),
      contact_email: stringOrNull(value.contact_email),
      expires_at: stringOrNull(value.expires_at),
      revoked_at: stringOrNull(value.revoked_at),
      created_at: createdAt,
      vendor_profiles: joinedVendor(value.vendor_profiles),
    }];
  });
}

export function normalizeVendorSubmissionRows(rows: unknown): VendorSubmissionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const vendorId = requiredString(value.vendor_id);
    const partNumber = requiredString(value.part_number);
    const proposedListPrice = numberOrNull(value.proposed_list_price);
    const currency = requiredString(value.currency);
    const effectiveDate = requiredString(value.effective_date);
    const status = submissionStatusOrNull(value.status);
    if (!id || !vendorId || !partNumber || proposedListPrice == null || !currency || !effectiveDate || !status) return [];
    return [{
      id,
      vendor_id: vendorId,
      part_number: partNumber,
      description: stringOrNull(value.description),
      proposed_list_price: proposedListPrice,
      currency,
      effective_date: effectiveDate,
      submission_notes: stringOrNull(value.submission_notes),
      submitted_by_name: stringOrNull(value.submitted_by_name),
      submitted_by_email: stringOrNull(value.submitted_by_email),
      status,
      review_notes: stringOrNull(value.review_notes),
      reviewed_at: stringOrNull(value.reviewed_at),
      vendor_profiles: joinedVendor(value.vendor_profiles),
    }];
  });
}

export function normalizeVendorPriceRows(rows: unknown): VendorPriceRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const vendorId = requiredString(value.vendor_id);
    const partNumber = requiredString(value.part_number);
    const currency = requiredString(value.currency);
    const effectiveDate = requiredString(value.effective_date);
    if (!id || !vendorId || !partNumber || !currency || !effectiveDate) return [];
    return [{
      id,
      vendor_id: vendorId,
      part_number: partNumber,
      description: stringOrNull(value.description),
      list_price: numberOrNull(value.list_price),
      currency,
      effective_date: effectiveDate,
    }];
  });
}
