import { describe, expect, it } from "bun:test";
import { buildDealAutopsySummary } from "./deal-autopsy";
import type { QrmActivityItem, QrmRepSafeDeal } from "./types";

const deal: QrmRepSafeDeal = {
  id: "deal-1",
  workspaceId: "default",
  name: "Autopsy Deal",
  stageId: "closed-lost",
  primaryContactId: null,
  companyId: "company-1",
  assignedRepId: null,
  amount: 100000,
  expectedCloseOn: null,
  nextFollowUpAt: null,
  lastActivityAt: "2026-04-01T10:00:00.000Z",
  closedAt: "2026-04-20T10:00:00.000Z",
  hubspotDealId: null,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-04-20T10:00:00.000Z",
  slaDeadlineAt: null,
  depositStatus: null,
  depositAmount: null,
};

const activities: QrmActivityItem[] = [
  {
    id: "note-1",
    workspaceId: "default",
    activityType: "note",
    body: "Customer was evaluating options",
    occurredAt: "2026-03-15T10:00:00.000Z",
    contactId: null,
    companyId: "company-1",
    dealId: "deal-1",
    createdBy: null,
    metadata: {},
    createdAt: "2026-03-15T10:00:00.000Z",
    updatedAt: "2026-03-15T10:00:00.000Z",
  },
  {
    id: "task-1",
    workspaceId: "default",
    activityType: "task",
    body: "Follow up",
    occurredAt: "2026-03-18T10:00:00.000Z",
    contactId: null,
    companyId: "company-1",
    dealId: "deal-1",
    createdBy: null,
    metadata: { task: { dueAt: "2026-04-10T10:00:00.000Z", status: "open" } },
    createdAt: "2026-03-18T10:00:00.000Z",
    updatedAt: "2026-03-18T10:00:00.000Z",
  },
  {
    id: "voice-1",
    workspaceId: "default",
    activityType: "note",
    body: "Voice capture",
    occurredAt: "2026-03-19T10:00:00.000Z",
    contactId: null,
    companyId: "company-1",
    dealId: "deal-1",
    createdBy: null,
    metadata: {
      source: "voice_capture",
      extractedSummary: {
        competitorsMentioned: ["CAT"],
      },
    },
    createdAt: "2026-03-19T10:00:00.000Z",
    updatedAt: "2026-03-19T10:00:00.000Z",
  },
];

describe("buildDealAutopsySummary", () => {
  it("summarizes loss context from notes, tasks, and voice evidence", () => {
    const summary = buildDealAutopsySummary({
      deal,
      lossFields: {
        lossReason: "Budget froze",
        competitor: "CAT dealer",
      },
      activities,
    });

    expect(summary.daysOpen).toBeGreaterThan(40);
    expect(summary.noteCount).toBe(2);
    expect(summary.overdueTaskCount).toBe(1);
    expect(summary.competitorMentionCount).toBe(1);
    expect(summary.lastTouchGapDays).toBe(19);
    expect(summary.findings.join(" | ")).toContain("Loss reason recorded: Budget froze");
    expect(summary.findings.join(" | ")).toContain("Competitor recorded: CAT dealer");
    expect(summary.findings.join(" | ")).toContain("overdue task");
  });
});
