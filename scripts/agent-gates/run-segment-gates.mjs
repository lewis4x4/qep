#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

function runCommand(command, cwd) {
  const startedAt = Date.now();
  const child = spawnSync(command, {
    cwd,
    env: process.env,
    shell: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const combinedOutput = [child.stdout ?? "", child.stderr ?? ""].join("\n").trim();

  return {
    exitCode: child.status ?? 1,
    durationMs,
    output: combinedOutput.length > 12000
      ? `${combinedOutput.slice(0, 12000)}\n...truncated...`
      : combinedOutput,
  };
}

function summarize(check) {
  if (check.status === "skipped") return `SKIP ${check.id}`;
  if (check.status === "pass") return `PASS ${check.id} (${check.duration_ms}ms)`;
  return `FAIL ${check.id} (${check.duration_ms}ms)`;
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();
const reportTimestamp = nowIso();
const reportDir = join(repoRoot, "test-results", "agent-gates");
mkdirSync(reportDir, { recursive: true });

const checks = [];

function pushCheck({ id, command, required = true, enabled = true, cwd = repoRoot }) {
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

  const result = runCommand(command, cwd);
  checks.push({
    id,
    status: result.exitCode === 0 ? "pass" : "fail",
    required,
    command,
    duration_ms: result.durationMs,
    output: result.output,
  });
}

pushCheck({
  id: "qa.migration-sequence",
  command: "bun run migrations:check",
  required: true,
});

pushCheck({
  id: "qa.parts-pressure-matrix",
  command: "bun run pressure:parts",
  required: true,
});

pushCheck({
  id: "qa.root-build",
  command: "bun run build",
  required: true,
});

pushCheck({
  id: "qa.web-build",
  command: "bun run build",
  cwd: join(repoRoot, "apps", "web"),
  required: true,
});

pushCheck({
  id: "qa.service-engine-deno-tests",
  command:
    "deno test supabase/functions/_shared/service-engine-smoke.test.ts supabase/functions/_shared/vendor-inbound-contract.test.ts supabase/functions/_shared/vendor-escalation-resend.test.ts --allow-read --allow-env",
  required: true,
});

pushCheck({
  id: "chaos.stress-suite",
  command: "bun run stress:test",
  required: options.chaos,
  enabled: options.chaos,
});

pushCheck({
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
