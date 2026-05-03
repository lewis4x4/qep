export type SourceDepartment = "sales" | "service" | "parts" | "finance" | "portal";
export type TargetDepartment = SourceDepartment | "management";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "pending" | "routed" | "acknowledged" | "resolved";

export interface CrossDepartmentAlert {
  id: string;
  workspace_id: string;
  source_department: SourceDepartment;
  target_department: TargetDepartment;
  customer_profile_id: string | null;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  context_entity_type: string | null;
  context_entity_id: string | null;
  status: AlertStatus;
  routed_to_user_id: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface HealthScoreComponents {
  deal_velocity: number;
  service_engagement: number;
  parts_revenue: number;
  financial_health: number;
  signals?: {
    parts_spend_30d?: number;
    parts_spend_90d?: number;
    service_visits_90d?: number;
    avg_days_to_pay?: number | null;
    quote_close_ratio?: number | null;
    won_deals_365d?: number;
    lost_deals_365d?: number;
  };
}

export interface CustomerHealthProfile {
  id: string;
  customer_name: string;
  company_name: string | null;
  health_score: number | null;
  health_score_components: HealthScoreComponents | null;
  health_score_updated_at: string | null;
  pricing_persona?: string | null;
  lifetime_value?: number | null;
}

export interface RevenueByMakeModelRow {
  make: string;
  model: string;
  unit_count: number;
  total_lifetime_revenue: number;
  avg_lifetime_revenue_per_unit: number;
}

export interface HealthRefreshSummary {
  total_scored: number;
  avg_score: number;
  distribution: {
    excellent: number;
    good: number;
    fair: number;
    at_risk: number;
  };
  top_customers: Array<{ health_score: number; customer_name: string }>;
}

export interface HealthRefreshRunResult {
  ok: boolean;
  scores_refreshed: number;
  alerts_generated: number;
}

export type HealthScoreDrawerComponents = Record<string, number | {
  score?: number;
  signals?: Record<string, unknown>;
}>;

export interface HealthScoreDrawerPayload {
  current_score: number | null;
  components: HealthScoreDrawerComponents;
  delta_7d: number | null;
  delta_30d: number | null;
  delta_90d: number | null;
}

export interface CustomerProfileLinkRow {
  crm_company_id: string | null;
}

export interface ArBlockRow {
  id: string;
  block_reason: string;
  current_max_aging_days: number | null;
  blocked_at: string;
}

const SOURCE_DEPARTMENTS = new Set<SourceDepartment>(["sales", "service", "parts", "finance", "portal"]);
const TARGET_DEPARTMENTS = new Set<TargetDepartment>(["sales", "service", "parts", "finance", "portal", "management"]);
const ALERT_SEVERITIES = new Set<AlertSeverity>(["info", "warning", "critical"]);
const ALERT_STATUSES = new Set<AlertStatus>(["pending", "routed", "acknowledged", "resolved"]);

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

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function sourceDepartmentOrNull(value: unknown): SourceDepartment | null {
  return typeof value === "string" && SOURCE_DEPARTMENTS.has(value as SourceDepartment)
    ? value as SourceDepartment
    : null;
}

function targetDepartmentOrNull(value: unknown): TargetDepartment | null {
  return typeof value === "string" && TARGET_DEPARTMENTS.has(value as TargetDepartment)
    ? value as TargetDepartment
    : null;
}

function alertSeverityOrNull(value: unknown): AlertSeverity | null {
  return typeof value === "string" && ALERT_SEVERITIES.has(value as AlertSeverity)
    ? value as AlertSeverity
    : null;
}

function alertStatusOrNull(value: unknown): AlertStatus | null {
  return typeof value === "string" && ALERT_STATUSES.has(value as AlertStatus)
    ? value as AlertStatus
    : null;
}

function normalizeHealthSignals(value: unknown): HealthScoreComponents["signals"] | undefined {
  if (!isRecord(value)) return undefined;
  const out: NonNullable<HealthScoreComponents["signals"]> = {};
  const partsSpend30d = numberOrNull(value.parts_spend_30d);
  const partsSpend90d = numberOrNull(value.parts_spend_90d);
  const serviceVisits90d = numberOrNull(value.service_visits_90d);
  const avgDaysToPay = numberOrNull(value.avg_days_to_pay);
  const quoteCloseRatio = numberOrNull(value.quote_close_ratio);
  const wonDeals365d = numberOrNull(value.won_deals_365d);
  const lostDeals365d = numberOrNull(value.lost_deals_365d);
  if (partsSpend30d != null) out.parts_spend_30d = partsSpend30d;
  if (partsSpend90d != null) out.parts_spend_90d = partsSpend90d;
  if (serviceVisits90d != null) out.service_visits_90d = serviceVisits90d;
  if (avgDaysToPay != null || value.avg_days_to_pay === null) out.avg_days_to_pay = avgDaysToPay;
  if (quoteCloseRatio != null || value.quote_close_ratio === null) out.quote_close_ratio = quoteCloseRatio;
  if (wonDeals365d != null) out.won_deals_365d = wonDeals365d;
  if (lostDeals365d != null) out.lost_deals_365d = lostDeals365d;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeHealthScoreComponents(value: unknown): HealthScoreComponents | null {
  if (!isRecord(value)) return null;
  const signals = normalizeHealthSignals(value.signals);
  return {
    deal_velocity: numberOrZero(value.deal_velocity),
    service_engagement: numberOrZero(value.service_engagement),
    parts_revenue: numberOrZero(value.parts_revenue),
    financial_health: numberOrZero(value.financial_health),
    ...(signals ? { signals } : {}),
  };
}

function normalizeDrawerComponents(value: unknown): HealthScoreDrawerComponents {
  if (!isRecord(value)) return {};
  const out: HealthScoreDrawerComponents = {};
  for (const [key, raw] of Object.entries(value)) {
    const numeric = numberOrNull(raw);
    if (numeric != null) {
      out[key] = numeric;
      continue;
    }
    if (!isRecord(raw)) continue;
    const score = numberOrNull(raw.score);
    const signals = isRecord(raw.signals) ? raw.signals : undefined;
    out[key] = {
      ...(score != null ? { score } : {}),
      ...(signals ? { signals } : {}),
    };
  }
  return out;
}

export function normalizeCrossDepartmentAlerts(rows: unknown): CrossDepartmentAlert[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const workspaceId = requiredString(value.workspace_id);
    const sourceDepartment = sourceDepartmentOrNull(value.source_department);
    const targetDepartment = targetDepartmentOrNull(value.target_department);
    const alertType = requiredString(value.alert_type);
    const severity = alertSeverityOrNull(value.severity);
    const title = requiredString(value.title);
    const status = alertStatusOrNull(value.status);
    const createdAt = requiredString(value.created_at);
    if (!id || !workspaceId || !sourceDepartment || !targetDepartment || !alertType || !severity || !title || !status || !createdAt) {
      return [];
    }
    return [{
      id,
      workspace_id: workspaceId,
      source_department: sourceDepartment,
      target_department: targetDepartment,
      customer_profile_id: stringOrNull(value.customer_profile_id),
      alert_type: alertType,
      severity,
      title,
      body: stringOrNull(value.body),
      context_entity_type: stringOrNull(value.context_entity_type),
      context_entity_id: stringOrNull(value.context_entity_id),
      status,
      routed_to_user_id: stringOrNull(value.routed_to_user_id),
      resolved_at: stringOrNull(value.resolved_at),
      created_at: createdAt,
    }];
  });
}

export function normalizeCustomerHealthProfiles(rows: unknown): CustomerHealthProfile[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const customerName = requiredString(value.customer_name);
    if (!id || !customerName) return [];
    return [{
      id,
      customer_name: customerName,
      company_name: stringOrNull(value.company_name),
      health_score: numberOrNull(value.health_score),
      health_score_components: normalizeHealthScoreComponents(value.health_score_components),
      health_score_updated_at: stringOrNull(value.health_score_updated_at),
      pricing_persona: stringOrNull(value.pricing_persona),
      lifetime_value: numberOrNull(value.lifetime_value),
    }];
  });
}

export function normalizeRevenueByMakeModelRows(rows: unknown): RevenueByMakeModelRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const make = requiredString(value.make);
    const model = requiredString(value.model);
    if (!make || !model) return [];
    return [{
      make,
      model,
      unit_count: numberOrZero(value.unit_count),
      total_lifetime_revenue: numberOrZero(value.total_lifetime_revenue),
      avg_lifetime_revenue_per_unit: numberOrZero(value.avg_lifetime_revenue_per_unit),
    }];
  });
}

export function normalizeHealthRefreshSummary(value: unknown): HealthRefreshSummary | null {
  if (!isRecord(value) || !isRecord(value.distribution)) return null;
  const topCustomers = Array.isArray(value.top_customers)
    ? value.top_customers.flatMap((row) => {
      if (!isRecord(row)) return [];
      const customerName = requiredString(row.customer_name);
      if (!customerName) return [];
      return [{ customer_name: customerName, health_score: numberOrZero(row.health_score) }];
    })
    : [];
  return {
    total_scored: numberOrZero(value.total_scored),
    avg_score: numberOrZero(value.avg_score),
    distribution: {
      excellent: numberOrZero(value.distribution.excellent),
      good: numberOrZero(value.distribution.good),
      fair: numberOrZero(value.distribution.fair),
      at_risk: numberOrZero(value.distribution.at_risk),
    },
    top_customers: topCustomers,
  };
}

export function normalizeHealthRefreshRunResult(value: unknown): HealthRefreshRunResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  return {
    ok: value.ok,
    scores_refreshed: numberOrZero(value.scores_refreshed),
    alerts_generated: numberOrZero(value.alerts_generated),
  };
}

export function normalizeHealthScoreDrawerPayload(value: unknown): HealthScoreDrawerPayload {
  if (!isRecord(value)) {
    return { current_score: null, components: {}, delta_7d: null, delta_30d: null, delta_90d: null };
  }
  return {
    current_score: numberOrNull(value.current_score),
    components: normalizeDrawerComponents(value.components),
    delta_7d: numberOrNull(value.delta_7d),
    delta_30d: numberOrNull(value.delta_30d),
    delta_90d: numberOrNull(value.delta_90d),
  };
}

export function normalizeCustomerProfileLinkRow(value: unknown): CustomerProfileLinkRow | null {
  if (!isRecord(value)) return null;
  return { crm_company_id: stringOrNull(value.crm_company_id) };
}

export function normalizeArBlockRow(value: unknown): ArBlockRow | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const blockReason = requiredString(value.block_reason);
  const blockedAt = requiredString(value.blocked_at);
  if (!id || !blockReason || !blockedAt) return null;
  return {
    id,
    block_reason: blockReason,
    current_max_aging_days: numberOrNull(value.current_max_aging_days),
    blocked_at: blockedAt,
  };
}
