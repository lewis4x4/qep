#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const QUEUE_PATH = resolve(repoRoot, "docs/IntelliDealer/_Manifests/QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md");
const openRows = runJson(["bun", "run", "parity:open-rows"]);
const workbookVerification = runJson(["bun", "run", "parity:workbook:verify"]);
const queueVerification = runJson(["bun", "run", "parity:decision-queue:verify", "--", "--expect-rows=7"]);
const preflight = runJsonAllowFailure(["bun", "run", "parity:closeout:preflight"]);
const queueRows = extractQueueRows(QUEUE_PATH);

const blockerRows = queueRows.filter((row) => row.status && row.status.toLowerCase() !== "complete");
const credentialFailures = (preflight.data?.failed ?? []).filter((check) => check.name?.startsWith("env present:"));
const verdict = openRows.ok && workbookVerification.ok && queueVerification.ok && blockerRows.length === 0 && credentialFailures.length === 0
  ? "READY_FOR_FINAL_GATE"
  : "BLOCKED";

const result = {
  verdict,
  generated_at: new Date().toISOString(),
  workbook: {
    open_rows: openRows.data?.total_open_rows ?? null,
    counts_by_sheet: openRows.data?.counts_by_sheet ?? {},
    counts_by_status: openRows.data?.counts_by_status ?? {},
    verification_verdict: workbookVerification.data?.verdict ?? "UNKNOWN",
  },
  closeout_preflight: {
    verdict: preflight.data?.verdict ?? "UNKNOWN",
    missing_env: credentialFailures.map((check) => check.name.replace("env present: ", "")),
  },
  external_decision_queue: {
    path: relative(QUEUE_PATH),
    verification_verdict: queueVerification.data?.verdict ?? "UNKNOWN",
    queued_count: blockerRows.length,
    rows: blockerRows.map((row) => ({
      slice: row.slice,
      workbook_row: row.workbook_row,
      current_status: row.current_status,
      assigned_to: row.assigned_to,
      target: row.target,
      status: row.status,
      closure_evidence_required: row.closure_evidence_required,
    })),
  },
  next_required_actions: buildNextActions(openRows.data, credentialFailures, blockerRows),
};

console.log(JSON.stringify(result, null, 2));

if (result.verdict !== "READY_FOR_FINAL_GATE") {
  process.exitCode = 1;
}

function buildNextActions(openRowsData, missingEnvChecks, blockers) {
  const actions = [];
  const totalOpen = openRowsData?.total_open_rows ?? null;

  if (totalOpen !== 0) {
    actions.push(`Close or formally de-scope ${totalOpen} workbook GAP/PARTIAL rows before using --expect-open=0.`);
  }

  if (blockers.length > 0) {
    actions.push("Resolve the external decision queue rows with live evidence, UAT evidence, or source-controlled replacement decisions.");
  }

  if (missingEnvChecks.length > 0) {
    actions.push(`Load missing live gate credentials: ${missingEnvChecks.map((check) => check.name.replace("env present: ", "")).join(", ")}.`);
  }

  if (actions.length === 0) {
    actions.push("Run bun run wave5:provider:verify and bun run segment:gates --segment parity-closeout --ui.");
  }

  return actions;
}

function runJson(command) {
  const run = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (run.status !== 0) {
    return { ok: false, data: null, stderr: run.stderr.trim(), stdout: run.stdout.trim() };
  }

  return { ok: true, data: parseScriptJson(run.stdout), stderr: run.stderr.trim() };
}

function runJsonAllowFailure(command) {
  const run = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
  });

  return {
    ok: run.status === 0,
    data: parseScriptJson(run.stdout),
    stderr: run.stderr.trim(),
    stdout: run.stdout.trim(),
  };
}

function parseScriptJson(stdout) {
  const text = stdout.trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) return null;
  return JSON.parse(text.slice(jsonStart));
}

function extractQueueRows(filePath) {
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const rows = [];

  for (const line of lines) {
    if (!line.startsWith("| Slice")) continue;
    if (line.includes("---")) continue;

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 8 || cells[0] === "Slice") continue;

    rows.push({
      slice: stripMarkdown(cells[0]),
      workbook_row: stripMarkdown(cells[1]),
      current_status: stripMarkdown(cells[2]),
      packet: stripMarkdown(cells[3]),
      closure_evidence_required: stripMarkdown(cells[4]),
      assigned_to: stripMarkdown(cells[5]),
      target: stripMarkdown(cells[6]),
      status: stripMarkdown(cells[7]),
    });
  }

  return rows;
}

function stripMarkdown(value) {
  return value
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function relative(filePath) {
  return filePath.startsWith(`${repoRoot}/`) ? filePath.slice(repoRoot.length + 1) : filePath;
}
