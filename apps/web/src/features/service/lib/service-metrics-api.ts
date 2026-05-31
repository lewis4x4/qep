import { supabase } from "@/lib/supabase";

export interface ServiceMarginByRequestTypeRow {
  workspaceId: string;
  requestType: string;
  jobCount: number;
  quoteCount: number;
  marginableLineCount: number;
  belowFloorLineCount: number;
  targetMetLineCount: number;
  totalLaborRevenue: number;
  totalMarginCostBasis: number;
  totalMarginAmount: number;
  marginPct: number | null;
  latestQuoteCreatedAt: string | null;
}

export interface ServiceOwnerWatchMetrics {
  workspaceId: string;
  jobs30d: number;
  comebackJobs30d: number;
  comebackRatePct: number | null;
  completedTatCount: number;
  avgCycleTimeHours: number | null;
  avgCycleTargetHours: number | null;
  tatOnTimePct: number | null;
  avgTechnicianEfficiencyPct: number | null;
  laborRecoveryPct: number | null;
  techHoursCharged30d: number;
  techHoursWorked30d: number;
  holdExcludedActualHours30d: number;
  holdHoursExcluded30d: number;
  shopJobs30d: number;
  fieldJobs30d: number;
  fieldMixPct: number | null;
  openWorkOrders: number;
  openHoldCount: number;
  openJobsOnHoldCount: number;
  warrantyRevenueCents: number;
  warrantyCostCents: number;
  warrantyRecoveryPct: number | null;
  avgHoursToFirstTouch: number | null;
  firstTouchJobCount: number;
  computedAt: string | null;
}

export interface ServiceCycleTimeBySegmentRow {
  workspaceId: string;
  segmentName: string;
  openSegmentCount: number;
  completedSegmentCount: number;
  avgActualDurationHours: number | null;
  avgTargetDurationHours: number | null;
  onTimePct: number | null;
  latestCompletedAt: string | null;
}

export interface ServiceOpenWorkOrdersByStatusRow {
  workspaceId: string;
  currentStage: string;
  openWorkOrderCount: number;
  withOpenHoldCount: number;
  oldestOpenedAt: string | null;
}

export interface ServiceOpenWorkOrdersByHoldReasonRow {
  workspaceId: string;
  holdState: string;
  openHoldCount: number;
  affectedWorkOrderCount: number;
  avgOpenHoldHours: number | null;
  latestHoldStartedAt: string | null;
}

export interface ServiceMetricsDashboardData {
  marginByRequestType: ServiceMarginByRequestTypeRow[];
  ownerWatch: ServiceOwnerWatchMetrics | null;
  cycleTimeBySegment: ServiceCycleTimeBySegmentRow[];
  openWorkOrdersByStatus: ServiceOpenWorkOrdersByStatusRow[];
  openWorkOrdersByHoldReason: ServiceOpenWorkOrdersByHoldReasonRow[];
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function formatServiceMetricLabel(value: string | null | undefined): string {
  const normalized = (value ?? "unknown").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "Unknown";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeMarginByRequestTypeRows(rows: unknown[]): ServiceMarginByRequestTypeRow[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      workspaceId: stringValue(source.workspace_id, "default"),
      requestType: stringValue(source.request_type),
      jobCount: numberValue(source.job_count),
      quoteCount: numberValue(source.quote_count),
      marginableLineCount: numberValue(source.marginable_line_count),
      belowFloorLineCount: numberValue(source.below_floor_line_count),
      targetMetLineCount: numberValue(source.target_met_line_count),
      totalLaborRevenue: numberValue(source.total_labor_revenue),
      totalMarginCostBasis: numberValue(source.total_margin_cost_basis),
      totalMarginAmount: numberValue(source.total_margin_amount),
      marginPct: nullableNumber(source.margin_pct),
      latestQuoteCreatedAt: nullableString(source.latest_quote_created_at),
    };
  });
}

export function normalizeOwnerWatchMetric(row: unknown): ServiceOwnerWatchMetrics | null {
  if (!row) return null;
  const source = row as Record<string, unknown>;
  return {
    workspaceId: stringValue(source.workspace_id, "default"),
    jobs30d: numberValue(source.jobs_30d),
    comebackJobs30d: numberValue(source.comeback_jobs_30d),
    comebackRatePct: nullableNumber(source.comeback_rate_pct),
    completedTatCount: numberValue(source.completed_tat_count),
    avgCycleTimeHours: nullableNumber(source.avg_cycle_time_hours),
    avgCycleTargetHours: nullableNumber(source.avg_cycle_target_hours),
    tatOnTimePct: nullableNumber(source.tat_on_time_pct),
    avgTechnicianEfficiencyPct: nullableNumber(source.avg_technician_efficiency_pct),
    laborRecoveryPct: nullableNumber(source.labor_recovery_pct),
    techHoursCharged30d: numberValue(source.tech_hours_charged_30d),
    techHoursWorked30d: numberValue(source.tech_hours_worked_30d),
    holdExcludedActualHours30d: numberValue(source.hold_excluded_actual_hours_30d),
    holdHoursExcluded30d: numberValue(source.hold_hours_excluded_30d),
    shopJobs30d: numberValue(source.shop_jobs_30d),
    fieldJobs30d: numberValue(source.field_jobs_30d),
    fieldMixPct: nullableNumber(source.field_mix_pct),
    openWorkOrders: numberValue(source.open_work_orders),
    openHoldCount: numberValue(source.open_hold_count),
    openJobsOnHoldCount: numberValue(source.open_jobs_on_hold_count),
    warrantyRevenueCents: numberValue(source.warranty_revenue_cents),
    warrantyCostCents: numberValue(source.warranty_cost_cents),
    warrantyRecoveryPct: nullableNumber(source.warranty_recovery_pct),
    avgHoursToFirstTouch: nullableNumber(source.avg_hours_to_first_touch),
    firstTouchJobCount: numberValue(source.first_touch_job_count),
    computedAt: nullableString(source.computed_at),
  };
}

export function normalizeCycleTimeRows(rows: unknown[]): ServiceCycleTimeBySegmentRow[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      workspaceId: stringValue(source.workspace_id, "default"),
      segmentName: stringValue(source.segment_name),
      openSegmentCount: numberValue(source.open_segment_count),
      completedSegmentCount: numberValue(source.completed_segment_count),
      avgActualDurationHours: nullableNumber(source.avg_actual_duration_hours),
      avgTargetDurationHours: nullableNumber(source.avg_target_duration_hours),
      onTimePct: nullableNumber(source.on_time_pct),
      latestCompletedAt: nullableString(source.latest_completed_at),
    };
  });
}

export function normalizeOpenStatusRows(rows: unknown[]): ServiceOpenWorkOrdersByStatusRow[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      workspaceId: stringValue(source.workspace_id, "default"),
      currentStage: stringValue(source.current_stage),
      openWorkOrderCount: numberValue(source.open_work_order_count),
      withOpenHoldCount: numberValue(source.with_open_hold_count),
      oldestOpenedAt: nullableString(source.oldest_opened_at),
    };
  });
}

export function normalizeOpenHoldReasonRows(rows: unknown[]): ServiceOpenWorkOrdersByHoldReasonRow[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      workspaceId: stringValue(source.workspace_id, "default"),
      holdState: stringValue(source.hold_state),
      openHoldCount: numberValue(source.open_hold_count),
      affectedWorkOrderCount: numberValue(source.affected_work_order_count),
      avgOpenHoldHours: nullableNumber(source.avg_open_hold_hours),
      latestHoldStartedAt: nullableString(source.latest_hold_started_at),
    };
  });
}

export function serviceMetricsDashboardIsEmpty(data: ServiceMetricsDashboardData): boolean {
  return (
    data.marginByRequestType.length === 0 &&
    !data.ownerWatch &&
    data.cycleTimeBySegment.length === 0 &&
    data.openWorkOrdersByStatus.length === 0 &&
    data.openWorkOrdersByHoldReason.length === 0
  );
}

async function loadViewRows(viewName: string, orderColumn?: string): Promise<unknown[]> {
  let query = supabase.from(viewName).select("*");
  if (orderColumn) query = query.order(orderColumn, { ascending: false });
  const { data, error } = await query;
  if (error) throw new Error(error.message || `Failed to load ${viewName}`);
  return data ?? [];
}

export async function fetchServiceMetricsDashboard(): Promise<ServiceMetricsDashboardData> {
  const [marginRows, ownerWatchRows, cycleRows, openStatusRows, openHoldRows] = await Promise.all([
    loadViewRows("v_service_metrics_margin_by_request_type", "total_margin_amount"),
    loadViewRows("v_service_metrics_owner_watch"),
    loadViewRows("v_service_metrics_cycle_time_by_segment", "completed_segment_count"),
    loadViewRows("v_service_metrics_open_wo_by_status", "open_work_order_count"),
    loadViewRows("v_service_metrics_open_wo_by_hold_reason", "open_hold_count"),
  ]);

  return {
    marginByRequestType: normalizeMarginByRequestTypeRows(marginRows),
    ownerWatch: normalizeOwnerWatchMetric(ownerWatchRows[0]),
    cycleTimeBySegment: normalizeCycleTimeRows(cycleRows),
    openWorkOrdersByStatus: normalizeOpenStatusRows(openStatusRows),
    openWorkOrdersByHoldReason: normalizeOpenHoldReasonRows(openHoldRows),
  };
}
