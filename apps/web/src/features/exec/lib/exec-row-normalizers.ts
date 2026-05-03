import type {
  AlertSeverity,
  AlertStatus,
  AnalyticsAlertRow,
  ExecRoleTab,
  KpiSnapshot,
  MetricDefinition,
  MetricRefreshState,
} from "./types";

const EXEC_ROLES = new Set<ExecRoleTab | "shared">(["ceo", "cfo", "coo", "shared"]);
const ALERT_SEVERITIES = new Set<AlertSeverity>(["info", "warn", "error", "critical"]);
const ALERT_STATUSES = new Set<AlertStatus>(["new", "acknowledged", "in_progress", "resolved", "dismissed"]);
const REFRESH_STATES = new Set<MetricRefreshState>(["fresh", "stale", "recalculated", "partial", "failed"]);

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

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberRecordOrNull(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const numeric = numberOrNull(raw);
    if (numeric != null) out[key] = numeric;
  }
  return out;
}

function roleOrNull(value: unknown): ExecRoleTab | "shared" | null {
  return typeof value === "string" && EXEC_ROLES.has(value as ExecRoleTab | "shared")
    ? value as ExecRoleTab | "shared"
    : null;
}

function severityOrNull(value: unknown): AlertSeverity | null {
  return typeof value === "string" && ALERT_SEVERITIES.has(value as AlertSeverity)
    ? value as AlertSeverity
    : null;
}

function statusOrNull(value: unknown): AlertStatus | null {
  return typeof value === "string" && ALERT_STATUSES.has(value as AlertStatus)
    ? value as AlertStatus
    : null;
}

function refreshStateOrNull(value: unknown): MetricRefreshState | null {
  return typeof value === "string" && REFRESH_STATES.has(value as MetricRefreshState)
    ? value as MetricRefreshState
    : null;
}

export function normalizeMetricDefinitions(rows: unknown): MetricDefinition[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const metricKey = requiredString(value.metric_key);
    const label = requiredString(value.label);
    const formulaText = requiredString(value.formula_text);
    const displayCategory = requiredString(value.display_category);
    const ownerRole = roleOrNull(value.owner_role);
    const refreshCadence = requiredString(value.refresh_cadence);
    if (!metricKey || !label || !formulaText || !displayCategory || !ownerRole || !refreshCadence || typeof value.is_executive_metric !== "boolean") {
      return [];
    }
    return [{
      metric_key: metricKey,
      label,
      description: stringOrNull(value.description),
      formula_text: formulaText,
      display_category: displayCategory,
      owner_role: ownerRole,
      source_tables: stringArray(value.source_tables),
      refresh_cadence: refreshCadence,
      drill_contract: recordOrEmpty(value.drill_contract),
      threshold_config: recordOrEmpty(value.threshold_config),
      synthetic_weights: numberRecordOrNull(value.synthetic_weights),
      is_executive_metric: value.is_executive_metric,
    }];
  });
}

export function normalizeKpiSnapshots(rows: unknown): KpiSnapshot[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const metricKey = requiredString(value.metric_key);
    const periodStart = requiredString(value.period_start);
    const periodEnd = requiredString(value.period_end);
    const calculatedAt = requiredString(value.calculated_at);
    const refreshState = refreshStateOrNull(value.refresh_state);
    if (!metricKey || !periodStart || !periodEnd || !calculatedAt || !refreshState) return [];
    return [{
      metric_key: metricKey,
      metric_value: numberOrNull(value.metric_value),
      comparison_value: numberOrNull(value.comparison_value),
      target_value: numberOrNull(value.target_value),
      confidence_score: numberOrNull(value.confidence_score),
      data_quality_score: numberOrNull(value.data_quality_score),
      period_start: periodStart,
      period_end: periodEnd,
      calculated_at: calculatedAt,
      refresh_state: refreshState,
      metadata: recordOrEmpty(value.metadata),
    }];
  });
}

export function normalizeAnalyticsAlertRows(rows: unknown): AnalyticsAlertRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const alertType = requiredString(value.alert_type);
    const severity = severityOrNull(value.severity);
    const title = requiredString(value.title);
    const roleTarget = roleOrNull(value.role_target);
    const status = statusOrNull(value.status);
    const createdAt = requiredString(value.created_at);
    const updatedAt = requiredString(value.updated_at);
    if (!id || !alertType || !severity || !title || !roleTarget || !status || !createdAt || !updatedAt) return [];
    return [{
      id,
      alert_type: alertType,
      metric_key: stringOrNull(value.metric_key),
      severity,
      title,
      description: stringOrNull(value.description),
      role_target: roleTarget,
      business_impact_value: numberOrNull(value.business_impact_value),
      business_impact_type: stringOrNull(value.business_impact_type),
      entity_type: stringOrNull(value.entity_type),
      entity_id: stringOrNull(value.entity_id),
      branch_id: stringOrNull(value.branch_id),
      root_cause_guess: stringOrNull(value.root_cause_guess),
      suggested_action: stringOrNull(value.suggested_action),
      status,
      acknowledged_at: stringOrNull(value.acknowledged_at),
      resolved_at: stringOrNull(value.resolved_at),
      created_at: createdAt,
      updated_at: updatedAt,
    }];
  });
}
