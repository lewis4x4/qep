import type { QrmDealDemoSummary } from "./deal-composite-types";
import type { QrmActivityItem, QrmTaskMetadata } from "./types";

export interface DealRoomApproval {
  id: string;
  subject: string;
  status: string;
}

export interface DealRoomSummary {
  noteCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  pendingApprovalCount: number;
  scenarioCount: number;
}

function readTaskMetadata(activity: QrmActivityItem): QrmTaskMetadata | null {
  if (activity.activityType !== "task") return null;
  const task = activity.metadata.task;
  return task && typeof task === "object" ? task as QrmTaskMetadata : null;
}

export function buildDealRoomSummary(input: {
  activities: QrmActivityItem[];
  demos: QrmDealDemoSummary[];
  approvals: DealRoomApproval[];
  nowTime?: number;
}): DealRoomSummary {
  const nowTime = input.nowTime ?? Date.now();
  const notes = input.activities.filter((activity) => activity.activityType === "note").length;
  const tasks = input.activities
    .map((activity) => readTaskMetadata(activity))
    .filter((task): task is QrmTaskMetadata => task != null);
  const openTaskCount = tasks.filter((task) => task.status !== "completed").length;
  const overdueTaskCount = tasks.filter((task) => {
    if (task.status === "completed" || !task.dueAt) return false;
    const dueAt = Date.parse(task.dueAt);
    return Number.isFinite(dueAt) && dueAt < nowTime;
  }).length;
  const demoApprovals = input.demos.filter((demo) => ["requested"].includes(demo.status)).length;
  const pendingFlowApprovals = input.approvals.filter((approval) => ["pending", "escalated"].includes(approval.status)).length;

  return {
    noteCount: notes,
    openTaskCount,
    overdueTaskCount,
    pendingApprovalCount: demoApprovals + pendingFlowApprovals,
    scenarioCount: 3,
  };
}
