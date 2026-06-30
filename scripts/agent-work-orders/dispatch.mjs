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

const args = parseArgs(process.argv.slice(2));
const runner = String(args.runner ?? process.env.QEP_AGENT_RUNNER ?? "claude_code").trim();
const max = clampInt(args.max ?? process.env.QEP_AGENT_DISPATCH_MAX ?? 1, 1, 10);
const leaseSeconds = clampInt(args.leaseSeconds ?? process.env.QEP_AGENT_LEASE_SECONDS ?? 900, 60, 3600);
const dryRun = args.dryRun === true;
const requireEnv = args.requireEnv === true;
const outputDir = resolve(REPO_ROOT, args.outputDir ?? "test-results/agent-work-orders");
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

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

  if (runner === "manual" || runner === "github_action") {
    const summary = `Generated handoff for ${workOrder.command} ${workOrder.task_id}; runner=${runner}.`;
    return await finish(workOrder, "done", summary, { handoff_path: handoffPath });
  }

  const runResult = await runConfiguredCommand(command, handoff, {
    QEP_AGENT_WORK_ORDER_ID: workOrder.id,
    QEP_AGENT_TASK_ID: workOrder.task_id,
    QEP_AGENT_COMMAND: workOrder.command,
    QEP_AGENT_HANDOFF_PATH: handoffPath,
    QEP_AGENT_RUNNER: runner,
  });

  if (runResult.exitCode === 0) {
    return await finish(workOrder, "done", `Runner ${runner} completed ${workOrder.command} ${workOrder.task_id}.`, {
      handoff_path: handoffPath,
      runner_exit_code: runResult.exitCode,
    });
  }

  return await finish(
    workOrder,
    "failed",
    `Runner ${runner} failed ${workOrder.command} ${workOrder.task_id}.`,
    {
      handoff_path: handoffPath,
      runner_exit_code: runResult.exitCode,
    },
    runResult.stderr || runResult.stdout || `runner exited ${runResult.exitCode}`,
  );
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
    "- For build work, commit and push on the active branch; do not auto-merge destructive or AUTHORIZE-class work.",
    "- If blocked, finish the work order as blocked with a concrete reason.",
    "",
    "## Source",
    "",
    `Linear issue: ${workOrder.source_issue_identifier ?? workOrder.source_issue_id ?? "(none)"}`,
    `Linear comment: ${workOrder.source_comment_url ?? workOrder.source_comment_id ?? "(none)"}`,
    "",
  ].join("\n");
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
