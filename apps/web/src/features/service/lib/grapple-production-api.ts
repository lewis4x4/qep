import { supabase } from "@/lib/supabase";

export const GRAPPLE_PRODUCTION_STAGES = [
  "intake",
  "chassis_arrival",
  "pre_build_review",
  "production_scheduled",
  "in_production",
  "production_hold",
  "ready_for_final_qc",
  "production_complete",
] as const;

export type GrappleProductionStage = (typeof GRAPPLE_PRODUCTION_STAGES)[number];

export interface GrapplePipelineBuild {
  id: string;
  workspaceId: string;
  buildNumber: string;
  sourceServiceJobId: string | null;
  productionStage: string;
  status: string;
  priority: string;
  customerCompanyId: string | null;
  customerCompanyName: string | null;
  customerContactId: string | null;
  customerContactName: string | null;
  salesDealId: string | null;
  salesDealName: string | null;
  chassisEquipmentId: string | null;
  chassisEquipmentName: string | null;
  chassisAssetTag: string | null;
  chassisSerialNumber: string | null;
  finishedEquipmentId: string | null;
  finishedEquipmentName: string | null;
  finishedAssetTag: string | null;
  assignedLeadId: string | null;
  assignedLeadName: string | null;
  assignedBuilderId: string | null;
  assignedBuilderName: string | null;
  targetStartDate: string | null;
  targetCompletionDate: string | null;
  actualStartedAt: string | null;
  actualCompletedAt: string | null;
  currentStageEnteredAt: string | null;
  daysInStage: number;
  timelineHealth: string;
  holdReason: string | null;
  productionNotes: string | null;
  metadata: unknown;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GrappleStageSummaryRow {
  workspaceId: string;
  productionStage: string;
  status: string;
  buildCount: number;
  overdueCount: number;
  dueSoonCount: number;
  unassignedLeadCount: number;
  unassignedBuilderCount: number;
  nextTargetCompletionDate: string | null;
  latestUpdatedAt: string | null;
}

export interface GrappleDashboardTimelineEvent {
  eventId: string;
  workspaceId: string;
  buildId: string;
  buildNumber: string;
  eventType: string;
  fromStage: string | null;
  toStage: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  metadata: unknown;
  actorId: string | null;
  actorName: string | null;
  createdAt: string | null;
}

export interface GrappleStageDuration {
  stage: string;
  entryCount: number;
  firstEnteredAt: string | null;
  lastExitedAt: string | null;
  durationSeconds: number;
  durationHours: number;
}

export interface GrappleBuildTimeline {
  buildId: string;
  workspaceId: string;
  buildNumber: string;
  productionStage: string;
  status: string;
  timelineStartedAt: string | null;
  timelineCompletedAt: string | null;
  latestTimelineAt: string | null;
  totalDurationSeconds: number;
  totalDurationHours: number;
  stageDurations: GrappleStageDuration[];
  currentStageEnteredAt: string | null;
  daysInCurrentStage: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GrappleProgressSheet {
  buildId: string;
  workspaceId: string;
  buildNumber: string;
  productionStage: string;
  status: string;
  priority: string;
  progressPercent: number;
  customerCompanyName: string | null;
  customerContactName: string | null;
  salesDealName: string | null;
  chassisEquipmentName: string | null;
  chassisAssetTag: string | null;
  chassisSerialNumber: string | null;
  finishedEquipmentName: string | null;
  finishedAssetTag: string | null;
  assignedLeadName: string | null;
  assignedBuilderName: string | null;
  targetStartDate: string | null;
  targetCompletionDate: string | null;
  actualStartedAt: string | null;
  actualCompletedAt: string | null;
  currentStageEnteredAt: string | null;
  daysInCurrentStage: number;
  timelineHealth: string;
  timelineStartedAt: string | null;
  timelineCompletedAt: string | null;
  totalDurationSeconds: number;
  totalDurationHours: number;
  stageDurations: GrappleStageDuration[];
  latestEventType: string | null;
  latestEventFromStage: string | null;
  latestEventToStage: string | null;
  latestEventNote: string | null;
  latestEventAt: string | null;
  finalQcReleaseReady: boolean;
  finalQcReleaseCode: string | null;
  finalQcReleaseReason: string | null;
  finalQcReleaseMissing: unknown[];
  holdReason: string | null;
  productionNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GrappleGtbInspection {
  id: string;
  buildId: string;
  buildNumber: string;
  inspectionNumber: number;
  status: string;
  overallResult: string | null;
  inspectedByName: string | null;
  inspectedAt: string | null;
  signedByName: string | null;
  signedAt: string | null;
  signatureName: string | null;
  itemCount: number;
  failedItemCount: number;
  reworkRequiredCount: number;
  notes: string | null;
  updatedAt: string | null;
}

export interface GrappleAccessoryInstall {
  id: string;
  buildId: string;
  buildNumber: string;
  accessoryType: string;
  accessoryLabel: string;
  status: string;
  installerName: string | null;
  startedAt: string | null;
  installedAt: string | null;
  blockedReason: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export interface GrapplePartsSheet {
  id: string;
  buildId: string;
  buildNumber: string;
  sheetNumber: number;
  status: string;
  title: string;
  issuedByName: string | null;
  issuedAt: string | null;
  lockedByName: string | null;
  lockedAt: string | null;
  lineCount: number;
  totalQuantity: number;
  totalCost: number;
  notes: string | null;
  updatedAt: string | null;
}

export interface GrappleFinalQcChecklist {
  id: string;
  buildId: string;
  buildNumber: string;
  checklistNumber: number;
  status: string;
  overallResult: string | null;
  qcPerformedByName: string | null;
  qcPerformedAt: string | null;
  completedByName: string | null;
  completedAt: string | null;
  leadSignedByName: string | null;
  leadSignedAt: string | null;
  leadSignatureName: string | null;
  itemCount: number;
  passedItemCount: number;
  failedItemCount: number;
  reworkRequiredCount: number;
  uncheckedItemCount: number;
  notes: string | null;
  updatedAt: string | null;
}

export interface GrappleProductionDashboardData {
  pipeline: GrapplePipelineBuild[];
  stageSummary: GrappleStageSummaryRow[];
  dashboardTimeline: GrappleDashboardTimelineEvent[];
  progressSheets: GrappleProgressSheet[];
  timelines: GrappleBuildTimeline[];
  gtbInspections: GrappleGtbInspection[];
  accessoryInstalls: GrappleAccessoryInstall[];
  partsSheets: GrapplePartsSheet[];
  finalQcChecklists: GrappleFinalQcChecklist[];
}

interface SupabaseRpcResult {
  data: unknown;
  error: { message?: string; details?: string | null } | null;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringValue(value: unknown, fallback = "unknown"): string {
  return nullableString(value) ?? fallback;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStageDurations(value: unknown): GrappleStageDuration[] {
  return arrayValue(value).map((item) => {
    const source = item as Record<string, unknown>;
    return {
      stage: stringValue(source.stage),
      entryCount: numberValue(source.entry_count),
      firstEnteredAt: nullableString(source.first_entered_at),
      lastExitedAt: nullableString(source.last_exited_at),
      durationSeconds: numberValue(source.duration_seconds),
      durationHours: numberValue(source.duration_hours),
    };
  });
}

export function formatGrappleLabel(value: string | null | undefined): string {
  const normalized = (value ?? "unknown").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "Unknown";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeGrapplePipelineRows(rows: unknown[]): GrapplePipelineBuild[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      id: stringValue(source.id),
      workspaceId: stringValue(source.workspace_id, "default"),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      sourceServiceJobId: nullableString(source.source_service_job_id),
      productionStage: stringValue(source.production_stage, "intake"),
      status: stringValue(source.status, "active"),
      priority: stringValue(source.priority, "normal"),
      customerCompanyId: nullableString(source.customer_company_id),
      customerCompanyName: nullableString(source.customer_company_name),
      customerContactId: nullableString(source.customer_contact_id),
      customerContactName: nullableString(source.customer_contact_name),
      salesDealId: nullableString(source.sales_deal_id),
      salesDealName: nullableString(source.sales_deal_name),
      chassisEquipmentId: nullableString(source.chassis_equipment_id),
      chassisEquipmentName: nullableString(source.chassis_equipment_name),
      chassisAssetTag: nullableString(source.chassis_asset_tag),
      chassisSerialNumber: nullableString(source.chassis_serial_number),
      finishedEquipmentId: nullableString(source.finished_equipment_id),
      finishedEquipmentName: nullableString(source.finished_equipment_name),
      finishedAssetTag: nullableString(source.finished_asset_tag),
      assignedLeadId: nullableString(source.assigned_lead_id),
      assignedLeadName: nullableString(source.assigned_lead_name),
      assignedBuilderId: nullableString(source.assigned_builder_id),
      assignedBuilderName: nullableString(source.assigned_builder_name),
      targetStartDate: nullableString(source.target_start_date),
      targetCompletionDate: nullableString(source.target_completion_date),
      actualStartedAt: nullableString(source.actual_started_at),
      actualCompletedAt: nullableString(source.actual_completed_at),
      currentStageEnteredAt: nullableString(source.current_stage_entered_at),
      daysInStage: numberValue(source.days_in_stage),
      timelineHealth: stringValue(source.timeline_health, "no_target"),
      holdReason: nullableString(source.hold_reason),
      productionNotes: nullableString(source.production_notes),
      metadata: source.metadata ?? null,
      createdAt: nullableString(source.created_at),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function normalizeGrappleStageSummaryRows(rows: unknown[]): GrappleStageSummaryRow[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      workspaceId: stringValue(source.workspace_id, "default"),
      productionStage: stringValue(source.production_stage, "intake"),
      status: stringValue(source.status, "active"),
      buildCount: numberValue(source.build_count),
      overdueCount: numberValue(source.overdue_count),
      dueSoonCount: numberValue(source.due_soon_count),
      unassignedLeadCount: numberValue(source.unassigned_lead_count),
      unassignedBuilderCount: numberValue(source.unassigned_builder_count),
      nextTargetCompletionDate: nullableString(source.next_target_completion_date),
      latestUpdatedAt: nullableString(source.latest_updated_at),
    };
  });
}

export function normalizeGrappleDashboardTimelineRows(rows: unknown[]): GrappleDashboardTimelineEvent[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      eventId: stringValue(source.event_id),
      workspaceId: stringValue(source.workspace_id, "default"),
      buildId: stringValue(source.build_id),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      eventType: stringValue(source.event_type, "event"),
      fromStage: nullableString(source.from_stage),
      toStage: nullableString(source.to_stage),
      fromStatus: nullableString(source.from_status),
      toStatus: nullableString(source.to_status),
      note: nullableString(source.note),
      metadata: source.metadata ?? null,
      actorId: nullableString(source.actor_id),
      actorName: nullableString(source.actor_name),
      createdAt: nullableString(source.created_at),
    };
  });
}

export function normalizeGrappleTimelineRows(rows: unknown[]): GrappleBuildTimeline[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      buildId: stringValue(source.build_id),
      workspaceId: stringValue(source.workspace_id, "default"),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      productionStage: stringValue(source.production_stage, "intake"),
      status: stringValue(source.status, "active"),
      timelineStartedAt: nullableString(source.timeline_started_at),
      timelineCompletedAt: nullableString(source.timeline_completed_at),
      latestTimelineAt: nullableString(source.latest_timeline_at),
      totalDurationSeconds: numberValue(source.total_duration_seconds),
      totalDurationHours: numberValue(source.total_duration_hours),
      stageDurations: normalizeStageDurations(source.stage_durations),
      currentStageEnteredAt: nullableString(source.current_stage_entered_at),
      daysInCurrentStage: numberValue(source.days_in_current_stage),
      createdAt: nullableString(source.created_at),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function normalizeGrappleProgressSheetRows(rows: unknown[]): GrappleProgressSheet[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      buildId: stringValue(source.build_id),
      workspaceId: stringValue(source.workspace_id, "default"),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      productionStage: stringValue(source.production_stage, "intake"),
      status: stringValue(source.status, "active"),
      priority: stringValue(source.priority, "normal"),
      progressPercent: numberValue(source.progress_percent),
      customerCompanyName: nullableString(source.customer_company_name),
      customerContactName: nullableString(source.customer_contact_name),
      salesDealName: nullableString(source.sales_deal_name),
      chassisEquipmentName: nullableString(source.chassis_equipment_name),
      chassisAssetTag: nullableString(source.chassis_asset_tag),
      chassisSerialNumber: nullableString(source.chassis_serial_number),
      finishedEquipmentName: nullableString(source.finished_equipment_name),
      finishedAssetTag: nullableString(source.finished_asset_tag),
      assignedLeadName: nullableString(source.assigned_lead_name),
      assignedBuilderName: nullableString(source.assigned_builder_name),
      targetStartDate: nullableString(source.target_start_date),
      targetCompletionDate: nullableString(source.target_completion_date),
      actualStartedAt: nullableString(source.actual_started_at),
      actualCompletedAt: nullableString(source.actual_completed_at),
      currentStageEnteredAt: nullableString(source.current_stage_entered_at),
      daysInCurrentStage: numberValue(source.days_in_current_stage),
      timelineHealth: stringValue(source.timeline_health, "no_target"),
      timelineStartedAt: nullableString(source.timeline_started_at),
      timelineCompletedAt: nullableString(source.timeline_completed_at),
      totalDurationSeconds: numberValue(source.total_duration_seconds),
      totalDurationHours: numberValue(source.total_duration_hours),
      stageDurations: normalizeStageDurations(source.stage_durations),
      latestEventType: nullableString(source.latest_event_type),
      latestEventFromStage: nullableString(source.latest_event_from_stage),
      latestEventToStage: nullableString(source.latest_event_to_stage),
      latestEventNote: nullableString(source.latest_event_note),
      latestEventAt: nullableString(source.latest_event_at),
      finalQcReleaseReady: booleanValue(source.final_qc_release_ready),
      finalQcReleaseCode: nullableString(source.final_qc_release_code),
      finalQcReleaseReason: nullableString(source.final_qc_release_reason),
      finalQcReleaseMissing: arrayValue(source.final_qc_release_missing),
      holdReason: nullableString(source.hold_reason),
      productionNotes: nullableString(source.production_notes),
      createdAt: nullableString(source.created_at),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function normalizeGrappleGtbInspectionRows(rows: unknown[]): GrappleGtbInspection[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      id: stringValue(source.id),
      buildId: stringValue(source.build_id),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      inspectionNumber: numberValue(source.inspection_number, 1),
      status: stringValue(source.status, "draft"),
      overallResult: nullableString(source.overall_result),
      inspectedByName: nullableString(source.inspected_by_name),
      inspectedAt: nullableString(source.inspected_at),
      signedByName: nullableString(source.signed_by_name),
      signedAt: nullableString(source.signed_at),
      signatureName: nullableString(source.signature_name),
      itemCount: numberValue(source.item_count),
      failedItemCount: numberValue(source.failed_item_count),
      reworkRequiredCount: numberValue(source.rework_required_count),
      notes: nullableString(source.notes),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function normalizeGrappleAccessoryInstallRows(rows: unknown[]): GrappleAccessoryInstall[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      id: stringValue(source.id),
      buildId: stringValue(source.build_id),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      accessoryType: stringValue(source.accessory_type),
      accessoryLabel: stringValue(source.accessory_label),
      status: stringValue(source.status, "not_started"),
      installerName: nullableString(source.installer_name),
      startedAt: nullableString(source.started_at),
      installedAt: nullableString(source.installed_at),
      blockedReason: nullableString(source.blocked_reason),
      verifiedByName: nullableString(source.verified_by_name),
      verifiedAt: nullableString(source.verified_at),
      notes: nullableString(source.notes),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function normalizeGrapplePartsSheetRows(rows: unknown[]): GrapplePartsSheet[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      id: stringValue(source.id),
      buildId: stringValue(source.build_id),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      sheetNumber: numberValue(source.sheet_number, 1),
      status: stringValue(source.status, "draft"),
      title: stringValue(source.title, "Build Parts Sheet"),
      issuedByName: nullableString(source.issued_by_name),
      issuedAt: nullableString(source.issued_at),
      lockedByName: nullableString(source.locked_by_name),
      lockedAt: nullableString(source.locked_at),
      lineCount: numberValue(source.line_count),
      totalQuantity: numberValue(source.total_quantity),
      totalCost: numberValue(source.total_cost),
      notes: nullableString(source.notes),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function normalizeGrappleFinalQcRows(rows: unknown[]): GrappleFinalQcChecklist[] {
  return rows.map((row) => {
    const source = row as Record<string, unknown>;
    return {
      id: stringValue(source.id),
      buildId: stringValue(source.build_id),
      buildNumber: stringValue(source.build_number, "Unnumbered build"),
      checklistNumber: numberValue(source.checklist_number, 1),
      status: stringValue(source.status, "draft"),
      overallResult: nullableString(source.overall_result),
      qcPerformedByName: nullableString(source.qc_performed_by_name),
      qcPerformedAt: nullableString(source.qc_performed_at),
      completedByName: nullableString(source.completed_by_name),
      completedAt: nullableString(source.completed_at),
      leadSignedByName: nullableString(source.lead_signed_by_name),
      leadSignedAt: nullableString(source.lead_signed_at),
      leadSignatureName: nullableString(source.lead_signature_name),
      itemCount: numberValue(source.item_count),
      passedItemCount: numberValue(source.passed_item_count),
      failedItemCount: numberValue(source.failed_item_count),
      reworkRequiredCount: numberValue(source.rework_required_count),
      uncheckedItemCount: numberValue(source.unchecked_item_count),
      notes: nullableString(source.notes),
      updatedAt: nullableString(source.updated_at),
    };
  });
}

export function grappleProductionDashboardIsEmpty(data: GrappleProductionDashboardData): boolean {
  const summaryBuildCount = data.stageSummary.reduce((sum, row) => sum + row.buildCount, 0);
  return (
    data.pipeline.length === 0 &&
    summaryBuildCount === 0 &&
    data.dashboardTimeline.length === 0 &&
    data.progressSheets.length === 0 &&
    data.timelines.length === 0 &&
    data.gtbInspections.length === 0 &&
    data.accessoryInstalls.length === 0 &&
    data.partsSheets.length === 0 &&
    data.finalQcChecklists.length === 0
  );
}

async function loadViewRows(viewName: string, orderColumn?: string, ascending = false): Promise<unknown[]> {
  let query = supabase.from(viewName).select("*");
  if (orderColumn) query = query.order(orderColumn, { ascending });
  const { data, error } = await query;
  if (error) throw new Error(error.message || `Failed to load ${viewName}`);
  return data ?? [];
}

export async function fetchGrappleProductionDashboard(): Promise<GrappleProductionDashboardData> {
  const [
    pipelineRows,
    stageSummaryRows,
    dashboardTimelineRows,
    progressSheetRows,
    timelineRows,
    gtbRows,
    accessoryRows,
    partsSheetRows,
    finalQcRows,
  ] = await Promise.all([
    loadViewRows("v_grapple_build_pipeline", "updated_at"),
    loadViewRows("v_grapple_build_stage_summary", "latest_updated_at"),
    loadViewRows("v_grapple_build_dashboard_timeline", "created_at"),
    loadViewRows("v_grapple_build_progress_sheets", "updated_at"),
    loadViewRows("v_grapple_build_timeline", "updated_at"),
    loadViewRows("v_grapple_build_gtb_inspections", "updated_at"),
    loadViewRows("v_grapple_build_accessory_installs", "updated_at"),
    loadViewRows("v_grapple_build_parts_sheets", "updated_at"),
    loadViewRows("v_grapple_build_final_qc_checklists", "updated_at"),
  ]);

  return {
    pipeline: normalizeGrapplePipelineRows(pipelineRows),
    stageSummary: normalizeGrappleStageSummaryRows(stageSummaryRows),
    dashboardTimeline: normalizeGrappleDashboardTimelineRows(dashboardTimelineRows),
    progressSheets: normalizeGrappleProgressSheetRows(progressSheetRows),
    timelines: normalizeGrappleTimelineRows(timelineRows),
    gtbInspections: normalizeGrappleGtbInspectionRows(gtbRows),
    accessoryInstalls: normalizeGrappleAccessoryInstallRows(accessoryRows),
    partsSheets: normalizeGrapplePartsSheetRows(partsSheetRows),
    finalQcChecklists: normalizeGrappleFinalQcRows(finalQcRows),
  };
}

async function callRpc(functionName: string, args: Record<string, unknown>): Promise<unknown> {
  const rpcClient = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<SupabaseRpcResult>;
  };
  const { data, error } = await rpcClient.rpc(functionName, args);
  if (error) throw new Error(error.message || error.details || `Failed to call ${functionName}`);
  return data;
}

export async function createGrappleBuild(input: {
  buildNumber: string;
  chassisEquipmentId?: string | null;
  finishedEquipmentId?: string | null;
  customerCompanyId?: string | null;
  customerContactId?: string | null;
  salesDealId?: string | null;
  targetStartDate?: string | null;
  targetCompletionDate?: string | null;
  assignedLeadId?: string | null;
  assignedBuilderId?: string | null;
  priority?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const data = await callRpc("create_grapple_build", {
    p_build_number: input.buildNumber,
    p_chassis_equipment_id: input.chassisEquipmentId ?? null,
    p_finished_equipment_id: input.finishedEquipmentId ?? null,
    p_customer_company_id: input.customerCompanyId ?? null,
    p_customer_contact_id: input.customerContactId ?? null,
    p_sales_deal_id: input.salesDealId ?? null,
    p_target_start_date: input.targetStartDate ?? null,
    p_target_completion_date: input.targetCompletionDate ?? null,
    p_assigned_lead_id: input.assignedLeadId ?? null,
    p_assigned_builder_id: input.assignedBuilderId ?? null,
    p_priority: input.priority ?? "normal",
    p_metadata: input.metadata ?? {},
  });
  return stringValue(data);
}

export async function transitionGrappleBuildStage(input: {
  buildId: string;
  nextStage: GrappleProductionStage;
  nextStatus?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<GrapplePipelineBuild> {
  const data = await callRpc("transition_grapple_build_stage", {
    p_build_id: input.buildId,
    p_next_stage: input.nextStage,
    p_next_status: input.nextStatus ?? null,
    p_note: input.note ?? null,
    p_metadata: input.metadata ?? {},
  });
  return normalizeGrapplePipelineRows([data])[0];
}

export async function signGrappleBuildFinalQc(input: {
  checklistId: string;
  signatureName: string;
  signatureStatement?: string | null;
  notes?: string | null;
}): Promise<GrappleFinalQcChecklist> {
  const data = await callRpc("sign_grapple_build_final_qc", {
    p_checklist_id: input.checklistId,
    p_signature_name: input.signatureName,
    p_signature_statement: input.signatureStatement ?? null,
    p_notes: input.notes ?? null,
  });
  return normalizeGrappleFinalQcRows([data])[0];
}
