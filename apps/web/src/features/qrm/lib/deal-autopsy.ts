import { readVoiceCaptureTimelineSignals } from "./voice-capture-activity-metadata";
import type { QrmActivityItem, QrmDealLossFields, QrmRepSafeDeal, QrmTaskMetadata } from "./types";

export interface DealAutopsySummary {
  daysOpen: number;
  overdueTaskCount: number;
  noteCount: number;
  competitorMentionCount: number;
  lastTouchGapDays: number | null;
  findings: string[];
}

function readTaskMetadata(activity: QrmActivityItem): QrmTaskMetadata | null {
  if (activity.activityType !== "task") return null;
  const task = activity.metadata.task;
  return task && typeof task === "object" ? task as QrmTaskMetadata : null;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDealAutopsySummary(input: {
  deal: QrmRepSafeDeal;
  lossFields: QrmDealLossFields | null;
  activities: QrmActivityItem[];
  nowTime?: number;
}): DealAutopsySummary {
  const nowTime = input.nowTime ?? Date.now();
  const createdAt = parseTime(input.deal.createdAt) ?? nowTime;
  const closedAt = parseTime(input.deal.closedAt) ?? nowTime;
  const lastActivityAt = parseTime(input.deal.lastActivityAt);
  const daysOpen = Math.max(1, Math.floor((closedAt - createdAt) / 86_400_000));
  const noteCount = input.activities.filter((activity) => activity.activityType === "note").length;
  const overdueTaskCount = input.activities.filter((activity) => {
    const task = readTaskMetadata(activity);
    if (!task || task.status === "completed" || !task.dueAt) return false;
    const dueAt = parseTime(task.dueAt);
    return dueAt != null && dueAt < closedAt;
  }).length;
  const competitorMentionCount = input.activities.reduce((count, activity) => {
    const signals = readVoiceCaptureTimelineSignals(activity);
    return count + (signals?.summary.competitorsMentioned?.length ?? 0);
  }, 0);
  const lastTouchGapDays = lastActivityAt == null ? null : Math.max(0, Math.floor((closedAt - lastActivityAt) / 86_400_000));

  const findings: string[] = [];
  if (input.lossFields?.lossReason) {
    findings.push(`Loss reason recorded: ${input.lossFields.lossReason}`);
  } else {
    findings.push("Loss reason is still missing.");
  }
  if (input.lossFields?.competitor) {
    findings.push(`Competitor recorded: ${input.lossFields.competitor}`);
  }
  if (competitorMentionCount > 0) {
    findings.push(`${competitorMentionCount} competitor mention${competitorMentionCount === 1 ? "" : "s"} appeared in voice evidence.`);
  }
  if (overdueTaskCount > 0) {
    findings.push(`${overdueTaskCount} overdue task${overdueTaskCount === 1 ? "" : "s"} were still open at loss.`);
  }
  if (lastTouchGapDays != null && lastTouchGapDays >= 14) {
    findings.push(`No recorded touch for ${lastTouchGapDays} days before the deal was lost.`);
  }
  if (noteCount === 0) {
    findings.push("No note trail was logged on the deal timeline.");
  }

  return {
    daysOpen,
    overdueTaskCount,
    noteCount,
    competitorMentionCount,
    lastTouchGapDays,
    findings,
  };
}
