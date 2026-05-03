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

export interface ExecSnapshotHistoryRow {
  metric_value: number | null;
  period_end: string;
  calculated_at: string;
  refresh_state: MetricRefreshState;
}

export interface ExecMarginWaterfallRow {
  month: string;
  revenue: number;
  gross_margin_dollars: number;
  net_contribution_dollars: number | null;
  load_dollars: number;
  loaded_margin_pct: number | null;
}

export interface ExecPolicyExceptionRow {
  id: string;
  source: string;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ExecBranchComparisonRow {
  branch_id: string | null;
  overdue: number | null;
  active: number | null;
  closed: number | null;
}

export interface ExecHealthMoverRow {
  customer_profile_id: string;
  health_score: number | null;
  health_score_updated_at: string | null;
}

export interface ExecCustomerProfileRow {
  id: string;
  customer_name: string;
  company_name: string | null;
  lifetime_value: number | null;
  fleet_size: number | null;
}

export interface ExecPacketResponse {
  ok: true;
  run_id: string | null;
  role: string;
  generated_at: string;
  markdown: string;
  json: Record<string, unknown>;
  stats: { definitions: number; snapshots: number; alerts: number };
}

export interface ExecPacketRunRow {
  id: string;
  generated_at: string;
  packet_md: string;
  metrics_count: number;
  alerts_count: number;
  delivery_status: string | null;
  delivered_at: string | null;
  delivery_target: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ExecTrafficRow {
  id: string;
  stock_number: string;
  ticket_type: string;
  status: string;
  blocker_reason: string | null;
  promised_delivery_at: string | null;
  to_location: string;
}

export interface ExecInventoryReadinessRow {
  total_units: number;
  ready_units: number;
  in_prep_units: number;
  blocked_units: number;
  intake_stalled: number;
  ready_rate_pct: number;
}

export interface ExecRentalReturnRow {
  id: string;
  status: string;
  aging_bucket: string | null;
  refund_status: string | null;
  damage_description: string | null;
}

export interface ExecInterventionHistoryRow {
  id: string;
  resolution_type: string;
  resolution_notes: string | null;
  resolved_at: string;
  time_to_resolve_minutes: number | null;
  recurrence_count: number;
}

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

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
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

export function normalizeSnapshotHistoryRows(rows: unknown): ExecSnapshotHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const periodEnd = requiredString(value.period_end);
    const calculatedAt = requiredString(value.calculated_at);
    const refreshState = refreshStateOrNull(value.refresh_state);
    if (!periodEnd || !calculatedAt || !refreshState) return [];
    return [{
      metric_value: numberOrNull(value.metric_value),
      period_end: periodEnd,
      calculated_at: calculatedAt,
      refresh_state: refreshState,
    }];
  });
}

export function normalizeExecMarginWaterfallRows(rows: unknown): ExecMarginWaterfallRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const month = requiredString(value.month);
    if (!month) return [];
    return [{
      month,
      revenue: numberOrZero(value.revenue),
      gross_margin_dollars: numberOrZero(value.gross_margin_dollars),
      net_contribution_dollars: numberOrNull(value.net_contribution_dollars),
      load_dollars: numberOrZero(value.load_dollars),
      loaded_margin_pct: numberOrNull(value.loaded_margin_pct),
    }];
  });
}

export function normalizeExecPolicyExceptionRows(rows: unknown): ExecPolicyExceptionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const source = requiredString(value.source);
    const severity = severityOrNull(value.severity);
    const title = requiredString(value.title);
    const createdAt = requiredString(value.created_at);
    if (!id || !source || !severity || !title || !createdAt) return [];
    return [{
      id,
      source,
      severity,
      title,
      detail: stringOrNull(value.detail),
      payload: recordOrEmpty(value.payload),
      created_at: createdAt,
    }];
  });
}

export function normalizeExecBranchComparisonRows(rows: unknown): ExecBranchComparisonRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    return [{
      branch_id: stringOrNull(value.branch_id),
      overdue: numberOrNull(value.overdue),
      active: numberOrNull(value.active),
      closed: numberOrNull(value.closed),
    }];
  });
}

export function normalizeExecHealthMoverRows(rows: unknown): ExecHealthMoverRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const customerProfileId = requiredString(value.customer_profile_id);
    if (!customerProfileId) return [];
    return [{
      customer_profile_id: customerProfileId,
      health_score: numberOrNull(value.health_score),
      health_score_updated_at: stringOrNull(value.health_score_updated_at),
    }];
  });
}

export function normalizeExecCustomerProfileRows(rows: unknown): ExecCustomerProfileRow[] {
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
      lifetime_value: numberOrNull(value.lifetime_value),
      fleet_size: numberOrNull(value.fleet_size),
    }];
  });
}

export function normalizeExecPacketResponse(value: unknown): ExecPacketResponse | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const role = requiredString(value.role);
  const generatedAt = requiredString(value.generated_at);
  const markdown = requiredString(value.markdown);
  if (!role || !generatedAt || !markdown || !isRecord(value.stats)) return null;
  return {
    ok: true,
    run_id: stringOrNull(value.run_id),
    role,
    generated_at: generatedAt,
    markdown,
    json: recordOrEmpty(value.json),
    stats: {
      definitions: numberOrZero(value.stats.definitions),
      snapshots: numberOrZero(value.stats.snapshots),
      alerts: numberOrZero(value.stats.alerts),
    },
  };
}

export function normalizeExecPacketRunRows(rows: unknown): ExecPacketRunRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const generatedAt = requiredString(value.generated_at);
    const packetMd = requiredString(value.packet_md);
    if (!id || !generatedAt || !packetMd) return [];
    return [{
      id,
      generated_at: generatedAt,
      packet_md: packetMd,
      metrics_count: numberOrZero(value.metrics_count),
      alerts_count: numberOrZero(value.alerts_count),
      delivery_status: stringOrNull(value.delivery_status),
      delivered_at: stringOrNull(value.delivered_at),
      delivery_target: stringOrNull(value.delivery_target),
      metadata: isRecord(value.metadata) ? value.metadata : null,
    }];
  });
}

export function normalizeExecTrafficRows(rows: unknown): ExecTrafficRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const stockNumber = requiredString(value.stock_number);
    const ticketType = requiredString(value.ticket_type);
    const status = requiredString(value.status);
    const toLocation = requiredString(value.to_location);
    if (!id || !stockNumber || !ticketType || !status || !toLocation) return [];
    return [{
      id,
      stock_number: stockNumber,
      ticket_type: ticketType,
      status,
      blocker_reason: stringOrNull(value.blocker_reason),
      promised_delivery_at: stringOrNull(value.promised_delivery_at),
      to_location: toLocation,
    }];
  });
}

export function normalizeExecInventoryReadinessRows(rows: unknown): ExecInventoryReadinessRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    return [{
      total_units: numberOrZero(value.total_units),
      ready_units: numberOrZero(value.ready_units),
      in_prep_units: numberOrZero(value.in_prep_units),
      blocked_units: numberOrZero(value.blocked_units),
      intake_stalled: numberOrZero(value.intake_stalled),
      ready_rate_pct: numberOrZero(value.ready_rate_pct),
    }];
  });
}

export function normalizeExecRentalReturnRows(rows: unknown): ExecRentalReturnRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const status = requiredString(value.status);
    if (!id || !status) return [];
    return [{
      id,
      status,
      aging_bucket: stringOrNull(value.aging_bucket),
      refund_status: stringOrNull(value.refund_status),
      damage_description: stringOrNull(value.damage_description),
    }];
  });
}

export function normalizeExecInterventionHistoryRows(rows: unknown): ExecInterventionHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = requiredString(value.id);
    const resolutionType = requiredString(value.resolution_type);
    const resolvedAt = requiredString(value.resolved_at);
    if (!id || !resolutionType || !resolvedAt) return [];
    return [{
      id,
      resolution_type: resolutionType,
      resolution_notes: stringOrNull(value.resolution_notes),
      resolved_at: resolvedAt,
      time_to_resolve_minutes: numberOrNull(value.time_to_resolve_minutes),
      recurrence_count: numberOrZero(value.recurrence_count),
    }];
  });
}
