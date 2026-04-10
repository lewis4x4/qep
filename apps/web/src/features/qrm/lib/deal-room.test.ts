import { describe, expect, it } from "bun:test";
import { buildDealRoomSummary } from "./deal-room";
import type { QrmActivityItem } from "./types";
import type { QrmDealDemoSummary } from "./deal-composite-types";

const activities: QrmActivityItem[] = [
  {
    id: "note-1",
    workspaceId: "default",
    activityType: "note",
    body: "Met with customer",
    occurredAt: "2026-04-10T10:00:00.000Z",
    contactId: null,
    companyId: null,
    dealId: "deal-1",
    createdBy: null,
    metadata: {},
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
  },
  {
    id: "task-1",
    workspaceId: "default",
    activityType: "task",
    body: "Follow up",
    occurredAt: "2026-04-10T10:00:00.000Z",
    contactId: null,
    companyId: null,
    dealId: "deal-1",
    createdBy: null,
    metadata: { task: { dueAt: "2026-04-09T10:00:00.000Z", status: "open" } },
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
  },
  {
    id: "task-2",
    workspaceId: "default",
    activityType: "task",
    body: "Completed task",
    occurredAt: "2026-04-10T10:00:00.000Z",
    contactId: null,
    companyId: null,
    dealId: "deal-1",
    createdBy: null,
    metadata: { task: { dueAt: "2026-04-08T10:00:00.000Z", status: "completed" } },
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:00:00.000Z",
  },
];

const demos: QrmDealDemoSummary[] = [
  {
    id: "demo-1",
    deal_id: "deal-1",
    equipment_category: "construction",
    status: "requested",
    max_hours: 10,
    hours_used: null,
    traffic_ticket_id: null,
    created_at: "2026-04-10T10:00:00.000Z",
    updated_at: "2026-04-10T10:00:00.000Z",
  } as QrmDealDemoSummary,
];

describe("buildDealRoomSummary", () => {
  it("counts notes, open tasks, overdue tasks, and pending approvals", () => {
    const summary = buildDealRoomSummary({
      activities,
      demos,
      approvals: [{ id: "fa-1", subject: "Margin approval", status: "pending" }],
      nowTime: Date.parse("2026-04-10T12:00:00.000Z"),
    });

    expect(summary.noteCount).toBe(1);
    expect(summary.openTaskCount).toBe(1);
    expect(summary.overdueTaskCount).toBe(1);
    expect(summary.pendingApprovalCount).toBe(2);
    expect(summary.scenarioCount).toBe(3);
  });
});
