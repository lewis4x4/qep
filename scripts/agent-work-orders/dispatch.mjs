#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);
loadLocalEnv(REPO_ROOT);

const RUNNERS = new Set(["claude_code", "cursor_background", "repoprompt", "github_action", "manual"]);
const RUNNER_COMMAND_ENV = {
  claude_code: "QEP_AGENT_CLAUDE_COMMAND",
  cursor_background: "QEP_AGENT_CURSOR_COMMAND",
  repoprompt: "QEP_AGENT_REPOPROMPT_COMMAND",
};
const LINEAR_API_URL = "https://api.linear.app/graphql";

const args = parseArgs(process.argv.slice(2));
const runner = String(args.runner ?? process.env.QEP_AGENT_RUNNER ?? "claude_code").trim();
const max = clampInt(args.max ?? process.env.QEP_AGENT_DISPATCH_MAX ?? 1, 1, 10);
const leaseSeconds = clampInt(args.leaseSeconds ?? process.env.QEP_AGENT_LEASE_SECONDS ?? 900, 60, 3600);
const dryRun = args.dryRun === true;
const requireEnv = args.requireEnv === true;
const outputDir = resolve(REPO_ROOT, args.outputDir ?? "test-results/agent-work-orders");
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const linearApiKey = process.env.LINEAR_API_KEY?.trim();

if (!RUNNERS.has(runner)) {
  fail(`unsupported runner "${runner}"`, 2);
}

const commandEnvName = RUNNER_COMMAND_ENV[runner];
const command = commandEnvName ? process.env[commandEnvName]?.trim() : "";
const envReady = Boolean(supabaseUrl && serviceRoleKey);
const runnerReady = !commandEnvName || Boolean(command);

if (dryRun) {
  print({
    mode: "dry-run",
    runner,
    max,
    lease_seconds: leaseSeconds,
    env_ready: envReady,
    runner_command_env: commandEnvName ?? null,
    runner_ready: runnerReady,
    progress_comments_ready: Boolean(linearApiKey),
    would_claim: envReady && runnerReady,
  });
  process.exit(envReady || !requireEnv ? 0 : 1);
}

if (!envReady) {
  const payload = {
    mode: "skip",
    reason: "missing_supabase_env",
    missing_env: [
      ...(!supabaseUrl ? ["SUPABASE_URL"] : []),
      ...(!serviceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ],
  };
  print(payload);
  process.exit(requireEnv ? 1 : 0);
}

if (!runnerReady) {
  print({
    mode: "skip",
    reason: "missing_runner_command",
    runner,
    required_env: commandEnvName,
  });
  process.exit(0);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const outcomes = [];
for (let i = 0; i < max; i += 1) {
  const claimed = await claimNextWorkOrder();
  if (!claimed) break;
  outcomes.push(await dispatchWorkOrder(claimed));
}

print({
  mode: "dispatch",
  runner,
  claimed: outcomes.length,
  outcomes,
});

async function claimNextWorkOrder() {
  const { data, error } = await admin.rpc("claim_qep_agent_work_order", {
    p_runner: runner,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim_qep_agent_work_order failed: ${error.message}`);
  return data ?? null;
}

async function dispatchWorkOrder(workOrder) {
  const task = await loadTask(workOrder.task_id);
  const handoff = buildHandoff(workOrder, task);
  mkdirSync(outputDir, { recursive: true });
  const handoffPath = join(outputDir, `${workOrder.id}.md`);
  writeFileSync(handoffPath, handoff);
  const progressComments = [];
  progressComments.push(await postProgressComment(workOrder, task, "started", { handoffPath }));

  if (runner === "manual" || runner === "github_action") {
    progressComments.push(await postProgressComment(workOrder, task, "handoff_ready", { handoffPath }));
    const summary = `Generated handoff for ${workOrder.command} ${workOrder.task_id}; runner=${runner}.`;
    const outcome = await finish(workOrder, "done", summary, {
      handoff_path: handoffPath,
      progress_comments: progressComments,
    });
    progressComments.push(await postProgressComment(workOrder, task, "done", {
      handoffPath,
      resultSummary: summary,
    }));
    return { ...outcome, progress_comments: progressComments };
  }

  progressComments.push(await postProgressComment(workOrder, task, "runner_launched", { handoffPath }));
  const runResult = await runConfiguredCommand(command, handoff, {
    QEP_AGENT_WORK_ORDER_ID: workOrder.id,
    QEP_AGENT_TASK_ID: workOrder.task_id,
    QEP_AGENT_COMMAND: workOrder.command,
    QEP_AGENT_HANDOFF_PATH: handoffPath,
    QEP_AGENT_RUNNER: runner,
    QEP_AGENT_LINEAR_ISSUE_ID: workOrder.source_issue_id ?? "",
    QEP_AGENT_LINEAR_ISSUE_IDENTIFIER: workOrder.source_issue_identifier ?? "",
    QEP_AGENT_SOURCE_COMMENT_URL: workOrder.source_comment_url ?? "",
    QEP_AGENT_PROGRESS_COMMENTS: linearApiKey ? "enabled" : "disabled",
  });

  if (runResult.exitCode === 0) {
    const summary = `Runner ${runner} completed ${workOrder.command} ${workOrder.task_id}.`;
    const outcome = await finish(workOrder, "done", summary, {
      handoff_path: handoffPath,
      runner_exit_code: runResult.exitCode,
      progress_comments: progressComments,
    });
    progressComments.push(await postProgressComment(workOrder, task, "done", {
      handoffPath,
      resultSummary: summary,
    }));
    return { ...outcome, progress_comments: progressComments };
  }

  const summary = `Runner ${runner} failed ${workOrder.command} ${workOrder.task_id}.`;
  const errorExcerpt = runResult.stderr || runResult.stdout || `runner exited ${runResult.exitCode}`;
  const outcome = await finish(
    workOrder,
    "failed",
    summary,
    {
      handoff_path: handoffPath,
      runner_exit_code: runResult.exitCode,
      progress_comments: progressComments,
    },
    errorExcerpt,
  );
  progressComments.push(await postProgressComment(workOrder, task, "failed", {
    handoffPath,
    resultSummary: summary,
    errorExcerpt,
  }));
  return { ...outcome, progress_comments: progressComments };
}

async function loadTask(taskId) {
  const { data, error } = await admin
    .from("qep_roadmap_tasks")
    .select("task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, notes")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load roadmap task ${taskId}: ${error.message}`);
  if (!data) throw new Error(`Roadmap task ${taskId} was not found`);
  return data;
}

async function finish(workOrder, status, resultSummary, result, error = null) {
  const { data, error: finishError } = await admin.rpc("finish_qep_agent_work_order", {
    p_work_order_id: workOrder.id,
    p_lease_token: workOrder.lease_token,
    p_status: status,
    p_result_summary: resultSummary,
    p_result: result,
    p_error: error,
    p_metadata: {
      dispatcher: "scripts/agent-work-orders/dispatch.mjs",
      dispatched_at: new Date().toISOString(),
    },
  });
  if (finishError) throw new Error(`finish_qep_agent_work_order failed: ${finishError.message}`);
  return {
    id: data.id,
    task_id: data.task_id,
    command: data.command,
    status: data.status,
    result_summary: data.result_summary,
  };
}

function buildHandoff(workOrder, task) {
  return [
    "# QEP Agent Work Order",
    "",
    `Work order: ${workOrder.id}`,
    `Roadmap: ${task.task_id}`,
    `Command: /${workOrder.command}`,
    `Runner: ${runner}`,
    `Requested by: ${workOrder.requested_by}`,
    "",
    "## Argument",
    "",
    workOrder.argument?.trim() || "(none)",
    "",
    "## Roadmap Task",
    "",
    `Title: ${task.title}`,
    `Stream/Wave: ${task.stream}/${task.wave}`,
    `Owner: ${task.owner ?? "(none)"}`,
    `Ship state: ${task.ship_state}`,
    `Blocking decision: ${task.blocking_decision ?? "(none)"}`,
    `Depends on: ${(task.depends_on ?? []).join(", ") || "(none)"}`,
    `Evidence: ${task.evidence_link ?? "(none)"}`,
    "",
    "## Description",
    "",
    task.description ?? "(none)",
    "",
    "## Notes",
    "",
    task.notes ?? "(none)",
    "",
    "## Execution Contract",
    "",
    "- Read AGENTS.md and the current roadmap context before changing files.",
    "- Keep changes scoped to this roadmap task.",
    "- Verify before finishing; include exact commands in the result.",
    "- Keep the source Linear issue current with started, tests-green, PR-opened, and terminal progress when credentials are available.",
    "- For build work, commit and push on the active branch; do not auto-merge destructive or AUTHORIZE-class work.",
    "- If blocked, finish the work order as blocked with a concrete reason.",
    "",
    "## Source",
    "",
    `Linear issue: ${workOrder.source_issue_identifier ?? workOrder.source_issue_id ?? "(none)"}`,
    `Linear comment: ${workOrder.source_comment_url ?? workOrder.source_comment_id ?? "(none)"}`,
    `Progress comments: ${linearApiKey ? "enabled" : "disabled"}`,
    "",
  ].join("\n");
}

async function postProgressComment(workOrder, task, checkpoint, details = {}) {
  const issueId = workOrder.source_issue_id?.trim?.() ?? "";
  if (!linearApiKey) {
    return { checkpoint, posted: false, reason: "missing_linear_api_key" };
  }
  if (!issueId) {
    return { checkpoint, posted: false, reason: "missing_source_issue_id" };
  }

  try {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: linearApiKey,
      },
      body: JSON.stringify({
        query: `
          mutation($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment { id }
            }
          }
        `,
        variables: {
          input: {
            issueId,
            body: formatProgressComment(workOrder, task, checkpoint, details),
          },
        },
      }),
    });

    const text = await response.text();
    const json = parseJsonResponse(text, response.status);
    if (!response.ok) {
      throw new Error(`Linear HTTP ${response.status}: ${summarizeLinearError(json)}`);
    }
    if (json.errors) {
      throw new Error(`Linear GraphQL errors: ${summarizeLinearError(json)}`);
    }
    const payload = json.data?.commentCreate;
    if (!payload?.success) {
      throw new Error("Linear commentCreate returned success=false");
    }
    return {
      checkpoint,
      posted: true,
      comment_id: payload.comment?.id ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `qep-agent-dispatch: progress comment ${checkpoint} failed for ${workOrder.id}: ${message}`,
    );
    return {
      checkpoint,
      posted: false,
      reason: "linear_comment_failed",
      error: message.slice(0, 1000),
    };
  }
}

function formatProgressComment(workOrder, task, checkpoint, details = {}) {
  const label = {
    started: "Started",
    handoff_ready: "Handoff ready",
    runner_launched: "Runner launched",
    done: "Done",
    failed: "Failed",
  }[checkpoint] ?? checkpoint;

  const lines = [
    `**QEP agent checkpoint: ${label}**`,
    "",
    `Roadmap: ${task.task_id} - ${task.title}`,
    `Work order: ${workOrder.id}`,
    `Command: /${workOrder.command}`,
    `Runner: ${runner}`,
  ];

  if (details.handoffPath) {
    lines.push(`Handoff: ${relativeRepoPath(details.handoffPath)}`);
  }
  if (details.resultSummary) {
    lines.push("", details.resultSummary);
  }
  if (details.errorExcerpt) {
    lines.push("", "Error excerpt:", "```", details.errorExcerpt.slice(0, 1200), "```");
  }

  return lines.join("\n");
}

function parseJsonResponse(text, status) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Linear returned non-JSON response (${status})`);
  }
}

function summarizeLinearError(json) {
  if (Array.isArray(json?.errors)) {
    return json.errors.map((entry) => entry.message ?? JSON.stringify(entry)).join("; ").slice(0, 1000);
  }
  return JSON.stringify(json).slice(0, 1000);
}

function relativeRepoPath(path) {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

function runConfiguredCommand(commandLine, stdin, extraEnv) {
  return new Promise((resolveRun) => {
    const child = spawn(commandLine, {
      shell: true,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (exitCode) => {
      resolveRun({
        exitCode,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
    child.stdin.end(stdin);
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--require-env") parsed.requireEnv = true;
    else {
      const match = arg.match(/^--([^=]+)=(.*)$/);
      if (match) {
        parsed[match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = match[2];
      }
    }
  }
  return parsed;
}

function clampInt(value, min, maxValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(Math.max(parsed, min), maxValue);
}

function print(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function fail(message, code = 1) {
  console.error(`qep-agent-dispatch: ${message}`);
  process.exit(code);
}
