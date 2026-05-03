export type ServiceAgreementStatus = "draft" | "active" | "expired" | "cancelled";

export type ServiceAgreementCompanyOption = {
  id: string;
  name: string;
};

export type ServiceAgreementEquipmentOption = {
  id: string;
  name: string | null;
  stock_number: string | null;
  serial_number: string | null;
  make: string | null;
  model: string | null;
};

export type ServiceAgreementJoinedCompany = {
  name?: string;
};

export type ServiceAgreementJoinedEquipment = {
  stock_number?: string | null;
  serial_number?: string | null;
  make?: string | null;
  model?: string | null;
  name?: string | null;
};

export type ServiceAgreementRow = {
  id: string;
  contract_number: string;
  status: ServiceAgreementStatus;
  customer_id: string | null;
  equipment_id: string | null;
  location_code: string | null;
  program_name: string;
  category: string | null;
  coverage_summary: string | null;
  starts_on: string | null;
  expires_on: string | null;
  renewal_date: string | null;
  billing_cycle: string | null;
  term_months: number | null;
  included_pm_services: number | null;
  estimated_contract_value: number | null;
  notes: string | null;
  qrm_companies?: ServiceAgreementJoinedCompany | ServiceAgreementJoinedCompany[] | null;
  qrm_equipment?: ServiceAgreementJoinedEquipment | ServiceAgreementJoinedEquipment[] | null;
};

export type ServiceAgreementMaintenanceRow = {
  id: string;
  label: string | null;
  scheduled_date: string | null;
  status: string;
};

const AGREEMENT_STATUSES = new Set<ServiceAgreementStatus>(["draft", "active", "expired", "cancelled"]);

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

function statusOrNull(value: unknown): ServiceAgreementStatus | null {
  return typeof value === "string" && AGREEMENT_STATUSES.has(value as ServiceAgreementStatus)
    ? value as ServiceAgreementStatus
    : null;
}

export function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeJoinedCompany(value: unknown): ServiceAgreementJoinedCompany | null {
  const row = one(value as Record<string, unknown> | Record<string, unknown>[] | null | undefined);
  if (!isRecord(row)) return null;
  const name = requiredString(row.name);
  return name ? { name } : null;
}

function normalizeJoinedEquipment(value: unknown): ServiceAgreementJoinedEquipment | null {
  const row = one(value as Record<string, unknown> | Record<string, unknown>[] | null | undefined);
  if (!isRecord(row)) return null;
  return {
    stock_number: stringOrNull(row.stock_number),
    serial_number: stringOrNull(row.serial_number),
    make: stringOrNull(row.make),
    model: stringOrNull(row.model),
    name: stringOrNull(row.name),
  };
}

export function normalizeServiceAgreementCompanyOptions(rows: unknown): ServiceAgreementCompanyOption[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const name = requiredString(value.name);
    if (!id || !name) return [];
    return [{ id, name }];
  });
}

export function normalizeServiceAgreementEquipmentOptions(rows: unknown): ServiceAgreementEquipmentOption[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    if (!id) return [];
    return [{
      id,
      name: stringOrNull(value.name),
      stock_number: stringOrNull(value.stock_number),
      serial_number: stringOrNull(value.serial_number),
      make: stringOrNull(value.make),
      model: stringOrNull(value.model),
    }];
  });
}

export function normalizeServiceAgreementRows(rows: unknown): ServiceAgreementRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const contractNumber = requiredString(value.contract_number);
    const status = statusOrNull(value.status);
    const programName = requiredString(value.program_name);
    if (!id || !contractNumber || !status || !programName) return [];
    return [{
      id,
      contract_number: contractNumber,
      status,
      customer_id: stringOrNull(value.customer_id),
      equipment_id: stringOrNull(value.equipment_id),
      location_code: stringOrNull(value.location_code),
      program_name: programName,
      category: stringOrNull(value.category),
      coverage_summary: stringOrNull(value.coverage_summary),
      starts_on: stringOrNull(value.starts_on),
      expires_on: stringOrNull(value.expires_on),
      renewal_date: stringOrNull(value.renewal_date),
      billing_cycle: stringOrNull(value.billing_cycle),
      term_months: numberOrNull(value.term_months),
      included_pm_services: numberOrNull(value.included_pm_services),
      estimated_contract_value: numberOrNull(value.estimated_contract_value),
      notes: stringOrNull(value.notes),
      qrm_companies: normalizeJoinedCompany(value.qrm_companies),
      qrm_equipment: normalizeJoinedEquipment(value.qrm_equipment),
    }];
  });
}

export function normalizeServiceAgreementRow(row: unknown): ServiceAgreementRow | null {
  return normalizeServiceAgreementRows(row ? [row] : [])[0] ?? null;
}

export function normalizeServiceAgreementMaintenanceRows(rows: unknown): ServiceAgreementMaintenanceRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const status = requiredString(value.status);
    if (!id || !status) return [];
    return [{
      id,
      label: stringOrNull(value.label),
      scheduled_date: stringOrNull(value.scheduled_date),
      status,
    }];
  });
}

export function deriveServiceAgreementStatus(
  status: ServiceAgreementStatus,
  expiresOn: string | null,
  now = new Date(),
): ServiceAgreementStatus {
  if (status === "cancelled" || status === "draft") return status;
  if (!expiresOn) return status;
  const expiry = new Date(`${expiresOn}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return status;
  return expiry.getTime() < now.getTime() ? "expired" : status;
}

export function formatAgreementWindow(startsOn: string | null, expiresOn: string | null): string {
  const fmt = (value: string | null) =>
    value
      ? new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";
  return `${fmt(startsOn)} → ${fmt(expiresOn)}`;
}

export function matchesAgreementSearch(
  row: {
    contract_number: string;
    location_code: string | null;
    program_name: string;
    category: string | null;
    qrm_companies?: { name?: string } | { name?: string }[] | null;
    qrm_equipment?: {
      stock_number?: string | null;
      serial_number?: string | null;
      make?: string | null;
      model?: string | null;
    } | Array<{
      stock_number?: string | null;
      serial_number?: string | null;
      make?: string | null;
      model?: string | null;
    }> | null;
  },
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const company = Array.isArray(row.qrm_companies) ? row.qrm_companies[0] : row.qrm_companies;
  const equipment = Array.isArray(row.qrm_equipment) ? row.qrm_equipment[0] : row.qrm_equipment;
  const haystack = [
    row.contract_number,
    row.location_code,
    row.program_name,
    row.category,
    company?.name,
    equipment?.stock_number,
    equipment?.serial_number,
    equipment?.make,
    equipment?.model,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
