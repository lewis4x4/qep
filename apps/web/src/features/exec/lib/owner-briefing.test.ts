import { describe, expect, it } from "bun:test";
import { buildOwnerBriefingBoard } from "./owner-briefing";
import type { AnalyticsAlertRow } from "./types";

const alerts: AnalyticsAlertRow[] = [
  {
    id: "a1",
    alert_type: "ar_exposure",
    metric_key: "ar_exposure_total",
    severity: "critical",
    title: "A/R exposure crossed critical threshold",
    description: "Exposure is above the critical bound.",
    role_target: "cfo",
    business_impact_value: 420000,
    business_impact_type: "currency",
    entity_type: "deal",
    entity_id: "deal-1",
    branch_id: null,
    root_cause_guess: null,
    suggested_action: null,
    status: "new",
    acknowledged_at: null,
    resolved_at: null,
    created_at: "2026-04-11T00:00:00.000Z",
    updated_at: "2026-04-11T00:00:00.000Z",
  },
  {
    id: "a2",
    alert_type: "inventory_readiness",
    metric_key: "intake_stalled_count",
    severity: "warn",
    title: "Inventory readiness softened",
    description: null,
    role_target: "coo",
    business_impact_value: 0,
    business_impact_type: null,
    entity_type: null,
    entity_id: null,
    branch_id: null,
    root_cause_guess: null,
    suggested_action: null,
    status: "new",
    acknowledged_at: null,
    resolved_at: null,
    created_at: "2026-04-11T00:00:00.000Z",
    updated_at: "2026-04-11T00:00:00.000Z",
  },
];

describe("buildOwnerBriefingBoard", () => {
  it("sorts owner signals into certainty buckets with confidence and trace", () => {
    const board = buildOwnerBriefingBoard({
      alerts,
      lenses: [
        { role: "ceo", label: "CEO", alerts: 0, criticalAlerts: 0, staleMetrics: 2, freshestAt: "2026-04-11T00:00:00.000Z" },
        { role: "cfo", label: "CFO", alerts: 3, criticalAlerts: 1, staleMetrics: 0, freshestAt: "2026-04-11T00:00:00.000Z" },
      ],
    });

    expect(board.summary.certain).toBe(1);
    expect(board.summary.probable).toBe(1);
    expect(board.summary.suspected).toBe(1);
    expect(board.summary.dontActYet).toBe(1);
    expect(board.signals[0]?.bucket).toBe("certain");
    expect(board.signals[0]?.confidence).toBe("high");
    expect(board.signals.every((signal) => signal.trace.length >= 2)).toBe(true);
  });
});
