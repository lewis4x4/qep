import { describe, expect, it } from "bun:test";
import {
  DEFAULT_GRAPPLE_GTB_INSPECTION_ITEMS,
  formatGrappleLabel,
  grappleProductionDashboardIsEmpty,
  normalizeGrappleGtbInspectionRows,
  normalizeGrapplePipelineRows,
  normalizeGrappleProgressSheetRows,
  normalizeGrappleStageSummaryRows,
  type GrappleProductionDashboardData,
} from "./grapple-production-api";

describe("grapple production api normalizers", () => {
  it("normalizes pipeline rows from Stream I dashboard views", () => {
    const rows = normalizeGrapplePipelineRows([
      {
        id: "build-1",
        workspace_id: "default",
        build_number: "GTB-1001",
        production_stage: "in_production",
        status: "active",
        priority: "rush",
        customer_company_name: "Quality Equipment",
        chassis_equipment_name: "Peterbilt 567",
        assigned_lead_name: "Lead One",
        target_completion_date: "2026-06-04",
        days_in_stage: "3",
        timeline_health: "due_soon",
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: "build-1",
        workspaceId: "default",
        buildNumber: "GTB-1001",
        productionStage: "in_production",
        priority: "rush",
        customerCompanyName: "Quality Equipment",
        chassisEquipmentName: "Peterbilt 567",
        assignedLeadName: "Lead One",
        targetCompletionDate: "2026-06-04",
        daysInStage: 3,
        timelineHealth: "due_soon",
      }),
    ]);
  });

  it("normalizes progress sheets with release gate and stage durations", () => {
    const rows = normalizeGrappleProgressSheetRows([
      {
        build_id: "build-1",
        build_number: "GTB-1001",
        production_stage: "ready_for_final_qc",
        status: "active",
        progress_percent: "90",
        total_duration_hours: "42.25",
        final_qc_release_ready: "true",
        final_qc_release_code: "final_qc_release_ready",
        final_qc_release_missing: [{ scope: "final_qc", field: "status" }],
        stage_durations: [
          {
            stage: "intake",
            entry_count: "1",
            first_entered_at: "2026-05-30T12:00:00Z",
            last_exited_at: "2026-05-31T12:00:00Z",
            duration_seconds: "86400",
            duration_hours: "24",
          },
        ],
      },
    ]);

    expect(rows[0]?.progressPercent).toBe(90);
    expect(rows[0]?.totalDurationHours).toBe(42.25);
    expect(rows[0]?.finalQcReleaseReady).toBe(true);
    expect(rows[0]?.finalQcReleaseCode).toBe("final_qc_release_ready");
    expect(rows[0]?.finalQcReleaseMissing).toHaveLength(1);
    expect(rows[0]?.stageDurations[0]).toEqual({
      stage: "intake",
      entryCount: 1,
      firstEnteredAt: "2026-05-30T12:00:00Z",
      lastExitedAt: "2026-05-31T12:00:00Z",
      durationSeconds: 86400,
      durationHours: 24,
    });
  });

  it("normalizes GTB inspection headers and keeps the standard inspection prompts", () => {
    const rows = normalizeGrappleGtbInspectionRows([
      {
        id: "inspection-1",
        build_id: "build-1",
        build_number: "GTB-1001",
        inspection_number: "2",
        status: "signed",
        overall_result: "pass",
        inspected_by_name: "Inspector One",
        inspected_at: "2026-06-01T13:00:00Z",
        signed_by_name: "Lead One",
        signed_at: "2026-06-01T14:00:00Z",
        item_count: "4",
        failed_item_count: "0",
        rework_required_count: "0",
      },
    ]);

    expect(rows[0]).toEqual(expect.objectContaining({
      id: "inspection-1",
      buildId: "build-1",
      buildNumber: "GTB-1001",
      inspectionNumber: 2,
      status: "signed",
      overallResult: "pass",
      inspectedByName: "Inspector One",
      signedByName: "Lead One",
      itemCount: 4,
      failedItemCount: 0,
      reworkRequiredCount: 0,
    }));
    expect(DEFAULT_GRAPPLE_GTB_INSPECTION_ITEMS.map((item) => item.itemKey)).toEqual([
      "mounting_frame_and_welds",
      "hydraulic_routing_and_pressure",
      "controls_safety_and_labels",
      "paint_photos_and_build_packet",
    ]);
  });

  it("coerces stage summary counts and formats labels", () => {
    const rows = normalizeGrappleStageSummaryRows([
      {
        workspace_id: "default",
        production_stage: "production_hold",
        status: "on_hold",
        build_count: "2",
        overdue_count: "1",
        due_soon_count: 0,
        unassigned_lead_count: "1",
        unassigned_builder_count: "0",
      },
    ]);

    expect(rows[0]?.buildCount).toBe(2);
    expect(rows[0]?.overdueCount).toBe(1);
    expect(formatGrappleLabel("ready_for_final_qc")).toBe("Ready For Final Qc");
    expect(formatGrappleLabel(null)).toBe("Unknown");
  });

  it("detects empty dashboard payloads", () => {
    const empty: GrappleProductionDashboardData = {
      pipeline: [],
      stageSummary: [],
      dashboardTimeline: [],
      progressSheets: [],
      timelines: [],
      gtbInspections: [],
      accessoryInstalls: [],
      partsSheets: [],
      finalQcChecklists: [],
    };

    expect(grappleProductionDashboardIsEmpty(empty)).toBe(true);
    expect(grappleProductionDashboardIsEmpty({
      ...empty,
      stageSummary: [{
        workspaceId: "default",
        productionStage: "intake",
        status: "active",
        buildCount: 0,
        overdueCount: 0,
        dueSoonCount: 0,
        unassignedLeadCount: 0,
        unassignedBuilderCount: 0,
        nextTargetCompletionDate: null,
        latestUpdatedAt: null,
      }],
    })).toBe(true);
    expect(grappleProductionDashboardIsEmpty({
      ...empty,
      stageSummary: [{
        workspaceId: "default",
        productionStage: "intake",
        status: "active",
        buildCount: 1,
        overdueCount: 0,
        dueSoonCount: 0,
        unassignedLeadCount: 0,
        unassignedBuilderCount: 0,
        nextTargetCompletionDate: null,
        latestUpdatedAt: null,
      }],
    })).toBe(false);
  });
});
