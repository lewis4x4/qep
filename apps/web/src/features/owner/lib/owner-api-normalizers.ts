export interface OwnerDashboardSummary {
  generated_at: string;
  workspace_id: string;
  revenue: {
    today: number;
    mtd: number;
    prev_month_same_day: number;
    mtd_vs_prev_pct: number | null;
  };
  pipeline: {
    weighted_total: number;
    at_risk_count: number;
  };
  parts: {
    total_catalog: number;
    dead_capital_usd: number;
    stockout_critical: number;
    predictive_revenue_open: number;
    predictive_open_plays: number;
    replenish_pending: number;
    margin_erosion_flags: number;
    last_import_at: string | null;
  };
  finance: {
    ar_aged_90_plus: number;
  };
}

export interface OwnershipHealthScore {
  score: number;
  generated_at: string;
  dimensions: {
    parts: number;
    sales: number;
    service: number;
    rental: number;
    finance: number;
  };
  weights: Record<string, number>;
  tier: "excellent" | "healthy" | "attention" | "critical";
}

export interface OwnerEvent {
  type: string;
  at: string;
  summary: string;
  amount?: number;
  revenue?: number;
  id?: string;
}

export interface OwnerEventFeed {
  since: string;
  count: number;
  events: OwnerEvent[];
}

export interface BranchStackRow {
  workspace_id: string;
  branch_code: string;
  parts_count: number;
  inventory_value: number;
  dead_parts: number;
  at_reorder_count: number;
  dead_pct: number;
  inventory_quartile: number;
  dead_parts_quartile_asc: number;
  reorder_quartile_asc: number;
}

export interface OwnerMorningBrief {
  brief: string;
  generated_at: string;
  cached?: boolean;
  model?: string;
}

export interface OwnerAskAnythingMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
}

export interface OwnerAskAnythingResponse {
  answer: string;
  tool_trace: { tool: string; input: unknown; result: unknown }[];
  model?: string;
  elapsed_ms?: number;
}

export interface PredictiveIntervention {
  title: string;
  projection: string;
  rationale: string;
  impact_usd?: number;
  horizon_days?: number;
  severity: "high" | "medium" | "low";
  action: {
    label: string;
    route: string;
  };
}

export interface PredictiveInterventionsResponse {
  interventions: PredictiveIntervention[];
  generated_at: string;
  model?: string;
}

export interface TeamSignalRep {
  rep_name: string;
  rep_id: string | null;
  ytd_wins: number;
  ytd_bookings: number;
  open_deals: number;
  close_rate_pct: number | null;
  avg_close_days: number | null;
}

export interface TeamSignalsResponse {
  generated_at: string;
  workspace_id: string;
  reps: TeamSignalRep[];
}

export type OwnerMarginApprovalStatus =
  | "pending"
  | "approved"
  | "approved_with_conditions"
  | "changes_requested"
  | "rejected"
  | "escalated"
  | "cancelled"
  | "superseded"
  | "expired";

export interface OwnerMarginExceptionRow {
  exception_id: string;
  workspace_id: string;
  exception_created_at: string;
  quote_package_id: string;
  brand_id: string | null;
  brand_code: string | null;
  brand_name: string | null;
  rep_id: string | null;
  rep_name: string | null;
  quoted_margin_pct: number;
  threshold_margin_pct: number;
  delta_pts: number;
  estimated_gap_cents: number | null;
  reason: string;
  approval_case_id: string | null;
  quote_number: string | null;
  customer_name: string | null;
  customer_company: string | null;
  branch_name: string | null;
  net_total: number | null;
  approval_margin_pct: number | null;
  approval_status: OwnerMarginApprovalStatus | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_role: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

const OWNER_MARGIN_APPROVAL_STATUSES = new Set<OwnerMarginApprovalStatus>([
  "pending",
  "approved",
  "approved_with_conditions",
  "changes_requested",
  "rejected",
  "escalated",
  "cancelled",
  "superseded",
  "expired",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, numberValue(item)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== null),
  );
}

function validHealthTier(value: unknown): OwnershipHealthScore["tier"] {
  return value === "excellent" || value === "healthy" || value === "attention" || value === "critical"
    ? value
    : "healthy";
}

function validSeverity(value: unknown): PredictiveIntervention["severity"] {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function validOwnerMarginApprovalStatus(value: unknown): OwnerMarginApprovalStatus | null {
  return typeof value === "string" && OWNER_MARGIN_APPROVAL_STATUSES.has(value as OwnerMarginApprovalStatus)
    ? (value as OwnerMarginApprovalStatus)
    : null;
}

function normalizeToolTraceRows(value: unknown): OwnerAskAnythingResponse["tool_trace"] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const record = objectValue(row);
    return {
      tool: stringValue(record.tool, "tool"),
      input: record.input,
      result: record.result,
    };
  });
}

export function normalizeOwnerDashboardSummary(value: unknown): OwnerDashboardSummary {
  const record = objectValue(value);
  const revenue = objectValue(record.revenue);
  const pipeline = objectValue(record.pipeline);
  const parts = objectValue(record.parts);
  const finance = objectValue(record.finance);
  return {
    generated_at: stringValue(record.generated_at),
    workspace_id: stringValue(record.workspace_id, "default"),
    revenue: {
      today: numberValue(revenue.today) ?? 0,
      mtd: numberValue(revenue.mtd) ?? 0,
      prev_month_same_day: numberValue(revenue.prev_month_same_day) ?? 0,
      mtd_vs_prev_pct: numberValue(revenue.mtd_vs_prev_pct),
    },
    pipeline: {
      weighted_total: numberValue(pipeline.weighted_total) ?? 0,
      at_risk_count: numberValue(pipeline.at_risk_count) ?? 0,
    },
    parts: {
      total_catalog: numberValue(parts.total_catalog) ?? 0,
      dead_capital_usd: numberValue(parts.dead_capital_usd) ?? 0,
      stockout_critical: numberValue(parts.stockout_critical) ?? 0,
      predictive_revenue_open: numberValue(parts.predictive_revenue_open) ?? 0,
      predictive_open_plays: numberValue(parts.predictive_open_plays) ?? 0,
      replenish_pending: numberValue(parts.replenish_pending) ?? 0,
      margin_erosion_flags: numberValue(parts.margin_erosion_flags) ?? 0,
      last_import_at: nullableString(parts.last_import_at),
    },
    finance: {
      ar_aged_90_plus: numberValue(finance.ar_aged_90_plus) ?? 0,
    },
  };
}

export function normalizeOwnershipHealthScore(value: unknown): OwnershipHealthScore {
  const record = objectValue(value);
  const dimensions = objectValue(record.dimensions);
  return {
    score: numberValue(record.score) ?? 0,
    generated_at: stringValue(record.generated_at),
    dimensions: {
      parts: numberValue(dimensions.parts) ?? 0,
      sales: numberValue(dimensions.sales) ?? 0,
      service: numberValue(dimensions.service) ?? 0,
      rental: numberValue(dimensions.rental) ?? 0,
      finance: numberValue(dimensions.finance) ?? 0,
    },
    weights: numericRecord(record.weights),
    tier: validHealthTier(record.tier),
  };
}

export function normalizeOwnerEventFeed(value: unknown): OwnerEventFeed {
  const record = objectValue(value);
  const events = Array.isArray(record.events)
    ? record.events.map(normalizeOwnerEvent).filter((event): event is OwnerEvent => event !== null)
    : [];
  return {
    since: stringValue(record.since),
    count: numberValue(record.count) ?? events.length,
    events,
  };
}

function normalizeOwnerEvent(value: unknown): OwnerEvent | null {
  if (!isRecord(value)) return null;
  const at = nullableString(value.at);
  const summary = nullableString(value.summary);
  if (!at || !summary) return null;
  const amount = numberValue(value.amount);
  const revenue = numberValue(value.revenue);
  return {
    type: stringValue(value.type, "event"),
    at,
    summary,
    ...(amount !== null ? { amount } : {}),
    ...(revenue !== null ? { revenue } : {}),
    ...(nullableString(value.id) ? { id: nullableString(value.id) ?? undefined } : {}),
  };
}

export function normalizeBranchStackRows(rows: unknown): BranchStackRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeBranchStackRow).filter((row): row is BranchStackRow => row !== null);
}

export function normalizeOwnerMarginExceptionRows(rows: unknown): OwnerMarginExceptionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(normalizeOwnerMarginExceptionRow)
    .filter((row): row is OwnerMarginExceptionRow => row !== null);
}

function normalizeOwnerMarginExceptionRow(row: unknown): OwnerMarginExceptionRow | null {
  if (!isRecord(row)) return null;
  const exceptionId = nullableString(row.exception_id);
  const workspaceId = nullableString(row.workspace_id);
  const exceptionCreatedAt = nullableString(row.exception_created_at);
  const quotePackageId = nullableString(row.quote_package_id);
  const quotedMarginPct = numberValue(row.quoted_margin_pct);
  const thresholdMarginPct = numberValue(row.threshold_margin_pct);
  const reason = nullableString(row.reason);

  if (
    !exceptionId ||
    !workspaceId ||
    !exceptionCreatedAt ||
    !quotePackageId ||
    quotedMarginPct === null ||
    thresholdMarginPct === null ||
    !reason
  ) {
    return null;
  }

  const deltaPts = numberValue(row.delta_pts) ?? quotedMarginPct - thresholdMarginPct;
  return {
    exception_id: exceptionId,
    workspace_id: workspaceId,
    exception_created_at: exceptionCreatedAt,
    quote_package_id: quotePackageId,
    brand_id: nullableString(row.brand_id),
    brand_code: nullableString(row.brand_code),
    brand_name: nullableString(row.brand_name),
    rep_id: nullableString(row.rep_id),
    rep_name: nullableString(row.rep_name),
    quoted_margin_pct: quotedMarginPct,
    threshold_margin_pct: thresholdMarginPct,
    delta_pts: deltaPts,
    estimated_gap_cents: numberValue(row.estimated_gap_cents),
    reason,
    approval_case_id: nullableString(row.approval_case_id),
    quote_number: nullableString(row.quote_number),
    customer_name: nullableString(row.customer_name),
    customer_company: nullableString(row.customer_company),
    branch_name: nullableString(row.branch_name),
    net_total: numberValue(row.net_total),
    approval_margin_pct: numberValue(row.approval_margin_pct),
    approval_status: validOwnerMarginApprovalStatus(row.approval_status),
    assigned_to: nullableString(row.assigned_to),
    assigned_to_name: nullableString(row.assigned_to_name),
    assigned_role: nullableString(row.assigned_role),
    decided_by: nullableString(row.decided_by),
    decided_by_name: nullableString(row.decided_by_name),
    decided_at: nullableString(row.decided_at),
    decision_note: nullableString(row.decision_note),
  };
}

function normalizeBranchStackRow(row: unknown): BranchStackRow | null {
  if (!isRecord(row)) return null;
  const branchCode = nullableString(row.branch_code);
  if (!branchCode) return null;
  return {
    workspace_id: stringValue(row.workspace_id, "default"),
    branch_code: branchCode,
    parts_count: numberValue(row.parts_count) ?? 0,
    inventory_value: numberValue(row.inventory_value) ?? 0,
    dead_parts: numberValue(row.dead_parts) ?? 0,
    at_reorder_count: numberValue(row.at_reorder_count) ?? 0,
    dead_pct: numberValue(row.dead_pct) ?? 0,
    inventory_quartile: numberValue(row.inventory_quartile) ?? 0,
    dead_parts_quartile_asc: numberValue(row.dead_parts_quartile_asc) ?? 0,
    reorder_quartile_asc: numberValue(row.reorder_quartile_asc) ?? 0,
  };
}

export function normalizeOwnerMorningBrief(value: unknown): OwnerMorningBrief | null {
  if (!isRecord(value)) return null;
  const brief = nullableString(value.brief);
  const generatedAt = nullableString(value.generated_at);
  if (!brief || !generatedAt) return null;
  return {
    brief,
    generated_at: generatedAt,
    ...(booleanValue(value.cached) !== undefined ? { cached: booleanValue(value.cached) } : {}),
    ...(nullableString(value.model) ? { model: nullableString(value.model) ?? undefined } : {}),
  };
}

export function normalizeOwnerAskAnythingResponse(value: unknown): OwnerAskAnythingResponse | null {
  if (!isRecord(value)) return null;
  const answer = nullableString(value.answer);
  if (!answer) return null;
  const elapsedMs = numberValue(value.elapsed_ms);
  return {
    answer,
    tool_trace: normalizeToolTraceRows(value.tool_trace),
    ...(nullableString(value.model) ? { model: nullableString(value.model) ?? undefined } : {}),
    ...(elapsedMs !== null ? { elapsed_ms: elapsedMs } : {}),
  };
}

export function normalizePredictiveInterventionsResponse(value: unknown): PredictiveInterventionsResponse {
  const record = objectValue(value);
  const interventions = Array.isArray(record.interventions)
    ? record.interventions
        .map(normalizePredictiveIntervention)
        .filter((row): row is PredictiveIntervention => row !== null)
    : [];
  return {
    interventions,
    generated_at: stringValue(record.generated_at),
    ...(nullableString(record.model) ? { model: nullableString(record.model) ?? undefined } : {}),
  };
}

function normalizePredictiveIntervention(value: unknown): PredictiveIntervention | null {
  if (!isRecord(value)) return null;
  const title = nullableString(value.title);
  const projection = nullableString(value.projection);
  const rationale = nullableString(value.rationale);
  const action = objectValue(value.action);
  const label = nullableString(action.label);
  const route = nullableString(action.route);
  if (!title || !projection || !rationale || !label || !route) return null;
  const impactUsd = numberValue(value.impact_usd);
  const horizonDays = numberValue(value.horizon_days);
  return {
    title,
    projection,
    rationale,
    ...(impactUsd !== null ? { impact_usd: impactUsd } : {}),
    ...(horizonDays !== null ? { horizon_days: horizonDays } : {}),
    severity: validSeverity(value.severity),
    action: { label, route },
  };
}

export function normalizeTeamSignalsResponse(value: unknown): TeamSignalsResponse {
  const record = objectValue(value);
  const reps = Array.isArray(record.reps)
    ? record.reps.map(normalizeTeamSignalRep).filter((rep): rep is TeamSignalRep => rep !== null)
    : [];
  return {
    generated_at: stringValue(record.generated_at),
    workspace_id: stringValue(record.workspace_id, "default"),
    reps,
  };
}

function normalizeTeamSignalRep(value: unknown): TeamSignalRep | null {
  if (!isRecord(value)) return null;
  const repName = nullableString(value.rep_name);
  if (!repName) return null;
  return {
    rep_name: repName,
    rep_id: nullableString(value.rep_id),
    ytd_wins: numberValue(value.ytd_wins) ?? 0,
    ytd_bookings: numberValue(value.ytd_bookings) ?? 0,
    open_deals: numberValue(value.open_deals) ?? 0,
    close_rate_pct: numberValue(value.close_rate_pct),
    avg_close_days: numberValue(value.avg_close_days),
  };
}
