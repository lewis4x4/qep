const CHECKPOINT_LABELS = Object.freeze({
  claimed: "Claimed",
  handoff_ready: "Handoff ready",
  runner_launched: "Runner launched",
  blocked: "Blocked",
  failed: "Failed",
  completed: "Completed",
});

const DONE_ALIASES = new Set(["done", "complete", "completed", "success", "succeeded"]);
const FAILED_ALIASES = new Set(["failed", "failure", "error"]);
const BLOCKED_ALIASES = new Set(["blocked", "block", "needs_input", "needs-info", "needs_info"]);

export function buildLinearCommentInput(workOrder, body) {
  const issueId = cleanString(workOrder?.source_issue_id);
  if (!issueId) return null;

  const parentId = cleanString(workOrder?.source_comment_id);
  return {
    issueId,
    body,
    ...(parentId ? { parentId } : {}),
  };
}

export function formatProgressComment({
  workOrder,
  task,
  runner,
  checkpoint,
  details = {},
  repoRoot = process.cwd(),
  env = process.env,
}) {
  const normalizedCheckpoint = normalizeCheckpoint(checkpoint);
  const label = CHECKPOINT_LABELS[normalizedCheckpoint] ?? checkpoint;
  const lines = [
    `**QEP agent checkpoint: ${label}**`,
    "",
    `Roadmap: ${task.task_id} - ${task.title}`,
    `Work order: ${workOrder.id}`,
    `Command: /${workOrder.command}`,
    `Runner: ${runner}`,
  ];

  const status = cleanString(details.status);
  if (status) lines.push(`Status: ${status}`);

  if (Number.isFinite(workOrder.attempt_count) && Number.isFinite(workOrder.max_attempts)) {
    lines.push(`Attempt: ${workOrder.attempt_count}/${workOrder.max_attempts}`);
  }

  const requestedBy = cleanString(workOrder.requested_by);
  if (requestedBy) lines.push(`Requested by: ${requestedBy}`);

  const issueLabel = cleanString(workOrder.source_issue_identifier) ?? cleanString(workOrder.source_issue_id);
  if (issueLabel) lines.push(`Linear issue: ${issueLabel}`);

  const sourceThread = cleanString(workOrder.source_comment_url) ?? cleanString(workOrder.source_comment_id);
  if (sourceThread) lines.push(`Source thread: ${sourceThread}`);

  if (details.handoffPath) {
    lines.push(`Handoff artifact: ${relativeRepoPath(String(details.handoffPath), repoRoot)}`);
  }

  const artifactRunUrl = cleanString(details.artifactRunUrl) ?? githubActionsRunUrl(env);
  if (artifactRunUrl) lines.push(`Artifact run: ${artifactRunUrl}`);

  if (details.runnerResultPath) {
    lines.push(`Runner result: ${relativeRepoPath(String(details.runnerResultPath), repoRoot)}`);
  }

  const resultSummary = cleanString(details.resultSummary);
  if (resultSummary) {
    lines.push("", "Result summary:", resultSummary);
  }

  const blockingReason = cleanString(details.blockingReason);
  if (blockingReason) {
    lines.push("", "Blocking reason:", blockingReason);
  }

  const errorExcerpt = cleanString(details.errorExcerpt);
  if (errorExcerpt) {
    lines.push("", "Error excerpt:", "```", clipForCodeFence(errorExcerpt, 1200), "```");
  }

  return lines.join("\n");
}

export function normalizeRunnerCompletion({ workOrder, runner, runResult, runnerReport }) {
  const reportStatus = normalizeTerminalStatus(readString(runnerReport, [
    "status",
    "state",
    "result_status",
    "resultStatus",
  ]));
  const status = reportStatus ?? (runResult.exitCode === 0 ? "done" : "failed");
  const resultSummary = readString(runnerReport, [
    "result_summary",
    "resultSummary",
    "summary",
    "message",
  ]) ?? fallbackSummary(workOrder, runner, status);
  const blockingReason = status === "blocked"
    ? readString(runnerReport, [
      "blocking_reason",
      "blockingReason",
      "blocked_reason",
      "blockedReason",
      "blocker",
      "error",
      "message",
    ]) ?? resultSummary
    : null;
  const failureExcerpt = readString(runnerReport, ["error", "stderr", "message"]) ??
    cleanString(runResult.stderr) ??
    cleanString(runResult.stdout) ??
    `runner exited ${runResult.exitCode}`;

  return {
    status,
    checkpoint: status === "done" ? "completed" : status,
    resultSummary,
    result: isRecord(runnerReport?.result) ? runnerReport.result : {},
    blockingReason,
    errorExcerpt: status === "failed" ? failureExcerpt : blockingReason,
  };
}

export function normalizeTerminalStatus(value) {
  const status = cleanString(value)?.toLowerCase();
  if (!status) return null;
  if (DONE_ALIASES.has(status)) return "done";
  if (FAILED_ALIASES.has(status)) return "failed";
  if (BLOCKED_ALIASES.has(status)) return "blocked";
  return null;
}

export function relativeRepoPath(path, repoRoot = process.cwd()) {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path;
}

function normalizeCheckpoint(checkpoint) {
  return checkpoint === "done" ? "completed" : checkpoint;
}

function fallbackSummary(workOrder, runner, status) {
  const command = workOrder?.command ?? "work";
  const taskId = workOrder?.task_id ?? "task";
  if (status === "done") return `Runner ${runner} completed ${command} ${taskId}.`;
  if (status === "blocked") return `Runner ${runner} blocked ${command} ${taskId}.`;
  return `Runner ${runner} failed ${command} ${taskId}.`;
}

function githubActionsRunUrl(env) {
  const serverUrl = cleanString(env.GITHUB_SERVER_URL) ?? "https://github.com";
  const repository = cleanString(env.GITHUB_REPOSITORY);
  const runId = cleanString(env.GITHUB_RUN_ID);
  if (!repository || !runId) return null;
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

function readString(record, keys) {
  if (!isRecord(record)) return null;
  for (const key of keys) {
    const value = record[key];
    const text = cleanString(value);
    if (text) return text;
  }
  return null;
}

function cleanString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clipForCodeFence(value, max) {
  const clipped = value.length > max ? value.slice(0, max).trimEnd() : value;
  return clipped.replaceAll("```", "'''");
}
