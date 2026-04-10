export interface WorkflowRunAuditRow {
  id: string;
  workflowSlug: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  errorText: string | null;
  deadLetterId: string | null;
}

export interface WorkflowStepAuditRow {
  runId: string;
  stepIndex: number;
  status: string;
  actionKey: string | null;
  errorText: string | null;
}

export interface WorkflowApprovalAuditRow {
  id: string;
  runId: string;
  status: string;
  requestedAt: string;
  dueAt: string | null;
}

export interface WorkflowExceptionAuditRow {
  id: string;
  source: string;
  status: string;
  title: string;
  createdAt: string;
}

export interface WorkflowActionAuditRow {
  actionType: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface WorkflowAuditSummary {
  breaks: number;
  stalls: number;
  reroutes: number;
  silentFails: number;
}

export interface WorkflowAuditBoard {
  summary: WorkflowAuditSummary;
  breaks: WorkflowRunAuditRow[];
  stalls: WorkflowRunAuditRow[];
  reroutes: WorkflowActionAuditRow[];
  silentFails: WorkflowExceptionAuditRow[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildWorkflowAuditBoard(input: {
  runs: WorkflowRunAuditRow[];
  steps: WorkflowStepAuditRow[];
  approvals: WorkflowApprovalAuditRow[];
  exceptions: WorkflowExceptionAuditRow[];
  actions: WorkflowActionAuditRow[];
  nowTime?: number;
}): WorkflowAuditBoard {
  const nowTime = input.nowTime ?? Date.now();
  const failedStepRunIds = new Set(
    input.steps.filter((step) => step.status === "failed").map((step) => step.runId),
  );
  const approvalByRun = new Map(input.approvals.map((approval) => [approval.runId, approval]));

  const breaks = input.runs
    .filter((run) => run.status === "dead_lettered" || failedStepRunIds.has(run.id))
    .sort((a, b) => (parseTime(b.startedAt) ?? 0) - (parseTime(a.startedAt) ?? 0));

  const stalls = input.runs
    .filter((run) => {
      if (run.status === "awaiting_approval" || run.status === "failed_retrying") return true;
      if (run.status === "running") {
        const startedAt = parseTime(run.startedAt);
        return startedAt != null && startedAt <= nowTime - 30 * 60_000;
      }
      return false;
    })
    .sort((a, b) => {
      const approvalA = approvalByRun.get(a.id);
      const approvalB = approvalByRun.get(b.id);
      return (parseTime(approvalA?.requestedAt ?? a.startedAt) ?? 0) - (parseTime(approvalB?.requestedAt ?? b.startedAt) ?? 0);
    });

  const reroutes = input.actions
    .filter((row) => ["workflow_replay", "workflow_override", "approval_decision"].includes(row.actionType))
    .sort((a, b) => (parseTime(b.createdAt) ?? 0) - (parseTime(a.createdAt) ?? 0));

  const silentFails = input.exceptions
    .filter((row) => row.status === "open" || row.status === "in_progress")
    .sort((a, b) => (parseTime(b.createdAt) ?? 0) - (parseTime(a.createdAt) ?? 0));

  return {
    summary: {
      breaks: breaks.length,
      stalls: stalls.length,
      reroutes: reroutes.length,
      silentFails: silentFails.length,
    },
    breaks,
    stalls,
    reroutes,
    silentFails,
  };
}
