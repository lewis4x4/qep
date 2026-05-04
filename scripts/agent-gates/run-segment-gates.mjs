#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";
import { loadLocalEnv } from "../_shared/local-env.mjs";

function parseArgs(argv) {
  const options = {
    segment: "",
    ui: false,
    chaos: true,
    designAdvisory: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value === "--segment") {
      options.segment = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (value === "--ui") {
      options.ui = true;
      continue;
    }
    if (value === "--no-chaos") {
      options.chaos = false;
      continue;
    }
    if (value === "--design-advisory") {
      options.designAdvisory = true;
      continue;
    }
  }

  options.segment = options.segment.trim() || "unnamed-segment";
  return options;
}

function nowIso() {
  return new Date().toISOString();
}

function tsForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

const REPORT_OUTPUT_MAX = 12000;
const HEARTBEAT_MS = Number.parseInt(process.env.SEGMENT_GATE_HEARTBEAT_MS ?? "15000", 10);

function truncateOutput(output) {
  const trimmed = output.trim();
  if (trimmed.length <= REPORT_OUTPUT_MAX) {
    return trimmed;
  }

  const head = trimmed.slice(0, REPORT_OUTPUT_MAX / 2).trimEnd();
  const tail = trimmed.slice(-REPORT_OUTPUT_MAX / 2).trimStart();
  return `${head}\n...truncated...\n${tail}`;
}

function logCheckStart({ id, command, cwd, repoRoot }) {
  const displayCwd = relative(repoRoot, cwd) || ".";
  console.log(`\n>>> ${id}`);
  console.log(`cwd: ${displayCwd}`);
  console.log(`cmd: ${command}`);
}

async function runCommand({ id, command, cwd, repoRoot }) {
  logCheckStart({ id, command, cwd, repoRoot });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let lastOutputAt = startedAt;
    let settled = false;

    const finish = (exitCode, errorMessage = "") => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);

      const durationMs = Date.now() - startedAt;
      const combinedOutput = [stdout, stderr, errorMessage].filter(Boolean).join("\n");

      console.log(`<<< ${id} ${exitCode === 0 ? "pass" : "fail"} (${durationMs}ms)`);

      resolve({
        exitCode,
        durationMs,
        output: truncateOutput(combinedOutput),
      });
    };

    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const quietSeconds = Math.floor((Date.now() - lastOutputAt) / 1000);
      console.log(`[${id}] still running (${elapsedSeconds}s elapsed, ${quietSeconds}s since last output)`);
    }, HEARTBEAT_MS);

    const streamChunk = (streamName, chunk) => {
      const text = chunk.toString();
      if (!text) return;

      lastOutputAt = Date.now();
      if (streamName === "stdout") {
        stdout += text;
        process.stdout.write(text);
        return;
      }

      stderr += text;
      process.stderr.write(text);
    };

    child.stdout?.on("data", (chunk) => streamChunk("stdout", chunk));
    child.stderr?.on("data", (chunk) => streamChunk("stderr", chunk));
    child.on("error", (error) => finish(1, `spawn error: ${error.message}`));
    child.on("close", (code) => finish(code ?? 1));
  });
}

function summarize(check) {
  if (check.status === "skipped") return `SKIP ${check.id}`;
  if (check.status === "pass") return `PASS ${check.id} (${check.duration_ms}ms)`;
  return `FAIL ${check.id} (${check.duration_ms}ms)`;
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();
loadLocalEnv(repoRoot);
const reportTimestamp = nowIso();
const reportDir = join(repoRoot, "test-results", "agent-gates");
mkdirSync(reportDir, { recursive: true });

const checks = [];

async function pushCheck({ id, command, required = true, enabled = true, cwd = repoRoot }) {
  if (!enabled) {
    checks.push({
      id,
      status: "skipped",
      required,
      command,
      duration_ms: 0,
      output: "check skipped by runtime options",
    });
    return;
  }

  const result = await runCommand({ id, command, cwd, repoRoot });
  checks.push({
    id,
    status: result.exitCode === 0 ? "pass" : "fail",
    required,
    command,
    duration_ms: result.durationMs,
    output: result.output,
  });
}

await pushCheck({
  id: "qa.migration-sequence",
  command: "bun run migrations:check",
  required: true,
});

await pushCheck({
  id: "qa.floor-layout-validation",
  command: "bun run floor:validate-layouts",
  required: true,
});

await pushCheck({
  id: "qa.quote-status-constraint-smoke",
  command: "bun run quote:status-smoke",
  required: true,
});

await pushCheck({
  id: "qa.parts-pressure-matrix",
  command: "bun run pressure:parts",
  required: true,
});

await pushCheck({
  id: "qa.edge-auth-audit",
  command: "bun run audit:edges",
  required: true,
});

await pushCheck({
  id: "qa.web-build",
  command: "bun run build",
  cwd: join(repoRoot, "apps", "web"),
  required: true,
});

await pushCheck({
  id: "qa.web-tests",
  command: "bun run test",
  required: true,
});

await pushCheck({
  id: "qa.parity-edge-deno-check",
  command: "deno check supabase/functions/integration-test-connection/index.ts supabase/functions/portal-api/index.ts",
  required: true,
});

await pushCheck({
  id: "qa.service-engine-deno-tests",
  command:
    "deno test supabase/functions/_shared/service-engine-smoke.test.ts supabase/functions/_shared/vendor-inbound-contract.test.ts supabase/functions/_shared/vendor-escalation-resend.test.ts --allow-read --allow-env",
  required: true,
});

await pushCheck({
  id: "qa.kb-retrieval-eval",
  command: "KB_EVAL_REQUIRED=true node ./scripts/kb-eval/run-eval.mjs",
  required: true,
});

await pushCheck({
  id: "qa.kb-integration-tests",
  command: "KB_INTEGRATION_REQUIRED=true bun run test:kb-integration",
  required: true,
});

await pushCheck({
  id: "qa.kb-workspace-isolation",
  command: "KB_ISOLATION_REQUIRED=true node ./scripts/kb-eval/workspace-isolation.mjs",
  required: true,
});

await pushCheck({
  id: "chaos.stress-suite",
  command: "bun run stress:test",
  required: options.chaos,
  enabled: options.chaos,
});

await pushCheck({
  id: "cdo.design-review",
  command: "bun run design:review",
  required: options.ui && !options.designAdvisory,
  enabled: options.ui,
});

const blockingFailures = checks.filter((check) => check.required && check.status === "fail");
const verdict = blockingFailures.length > 0 ? "FAIL" : "PASS";

const report = {
  segment: options.segment,
  agent: "segment_gate_runner",
  timestamp: reportTimestamp,
  verdict,
  options: {
    ui: options.ui,
    chaos: options.chaos,
    design_advisory: options.designAdvisory,
  },
  checks,
  summary: {
    total: checks.length,
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    blocking_failures: blockingFailures.map((check) => check.id),
  },
  artifacts: [
    "/tmp/qep-design-review-report.json",
    "/tmp/qep-mobile-admin-rep-redirect.png",
    "test-results/design-review/floor-desktop.png",
    "test-results/design-review/floor-mobile.png",
  ],
};

const reportPath = join(
  reportDir,
  `${tsForFilename()}-${options.segment.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`
);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`segment: ${options.segment}`);
console.log(`verdict: ${verdict}`);
console.log(`report: ${reportPath}`);
for (const check of checks) {
  console.log(summarize(check));
}

if (verdict === "FAIL") {
  process.exit(1);
}
