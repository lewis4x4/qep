export type ServiceLaborWorkOrderStatus = "all" | "customer" | "warranty" | "internal";
export type ServiceLaborPricingCode =
  | "fixed_price"
  | "list_plus_pct"
  | "list_minus_pct"
  | "cost_plus_pct"
  | "cost_minus_pct";

export type ServiceLaborPricingRuleRow = {
  contract?: never;
  location_code: string | null;
  customer_id: string | null;
  customer_group_label: string | null;
  work_order_status: ServiceLaborWorkOrderStatus;
  labor_type_code: string | null;
  premium_code: string | null;
  default_premium_code: string | null;
  comment: string | null;
  pricing_code: ServiceLaborPricingCode;
  pricing_value: number;
  active: boolean;
};

export type ServiceLaborPricingBranchConfigRow = {
  id: string;
  branch_id: string;
  default_labor_rate: number;
};

export type ServiceLaborPricingCompanyOption = {
  id: string;
  name: string;
};

export type ServiceLaborPricingRuleWithCompany = ServiceLaborPricingRuleRow & {
  id: string;
  effective_start_on: string | null;
  effective_end_on: string | null;
  qrm_companies?: { name?: string } | { name?: string }[] | null;
};

const WORK_ORDER_STATUSES = new Set<ServiceLaborWorkOrderStatus>(["all", "customer", "warranty", "internal"]);
const PRICING_CODES = new Set<ServiceLaborPricingCode>([
  "fixed_price",
  "list_plus_pct",
  "list_minus_pct",
  "cost_plus_pct",
  "cost_minus_pct",
]);

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

function workOrderStatusOrNull(value: unknown): ServiceLaborWorkOrderStatus | null {
  return typeof value === "string" && WORK_ORDER_STATUSES.has(value as ServiceLaborWorkOrderStatus)
    ? value as ServiceLaborWorkOrderStatus
    : null;
}

function pricingCodeOrNull(value: unknown): ServiceLaborPricingCode | null {
  return typeof value === "string" && PRICING_CODES.has(value as ServiceLaborPricingCode)
    ? value as ServiceLaborPricingCode
    : null;
}

export function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function normalizeServiceLaborBranchConfigRows(rows: unknown): ServiceLaborPricingBranchConfigRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const branchId = requiredString(value.branch_id);
    const defaultLaborRate = numberOrNull(value.default_labor_rate);
    if (!id || !branchId || defaultLaborRate == null) return [];
    return [{ id, branch_id: branchId, default_labor_rate: defaultLaborRate }];
  });
}

export function normalizeServiceLaborCompanyOptions(rows: unknown): ServiceLaborPricingCompanyOption[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const name = requiredString(value.name);
    if (!id || !name) return [];
    return [{ id, name }];
  });
}

function normalizeJoinedCompany(value: unknown): ServiceLaborPricingRuleWithCompany["qrm_companies"] {
  const company = one(value as { name?: unknown } | { name?: unknown }[] | null | undefined);
  if (!isRecord(company)) return null;
  const name = requiredString(company.name);
  return name ? { name } : null;
}

export function normalizeServiceLaborPricingRuleRows(rows: unknown): ServiceLaborPricingRuleWithCompany[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const workOrderStatus = workOrderStatusOrNull(value.work_order_status);
    const pricingCode = pricingCodeOrNull(value.pricing_code);
    const pricingValue = numberOrNull(value.pricing_value);
    if (!id || !workOrderStatus || !pricingCode || pricingValue == null || typeof value.active !== "boolean") {
      return [];
    }
    return [{
      id,
      location_code: stringOrNull(value.location_code),
      customer_id: stringOrNull(value.customer_id),
      customer_group_label: stringOrNull(value.customer_group_label),
      work_order_status: workOrderStatus,
      labor_type_code: stringOrNull(value.labor_type_code),
      premium_code: stringOrNull(value.premium_code),
      default_premium_code: stringOrNull(value.default_premium_code),
      comment: stringOrNull(value.comment),
      pricing_code: pricingCode,
      pricing_value: pricingValue,
      active: value.active,
      effective_start_on: stringOrNull(value.effective_start_on),
      effective_end_on: stringOrNull(value.effective_end_on),
      qrm_companies: normalizeJoinedCompany(value.qrm_companies),
    }];
  });
}

export function formatLaborPricingRule(rule: ServiceLaborPricingRuleRow): string {
  if (rule.pricing_code === "fixed_price") {
    return `$${Number(rule.pricing_value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}/hr fixed`;
  }
  const sign = rule.pricing_code.endsWith("minus_pct") ? "-" : "+";
  return `${sign}${Number(rule.pricing_value).toLocaleString()}% ${rule.pricing_code.startsWith("cost") ? "cost" : "list"}`;
}
