#!/usr/bin/env bun

import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, chmodSync, unlinkSync, rmdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../_shared/local-env.mjs";

export function parseArgs(argv) {
  const options = {
    segment: "",
    ui: false,
    chaos: true,
    designAdvisory: false,
    localOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value === "--segment") {
      options.segment = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (value === "--local-only") { options.localOnly = true; continue; }
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

const LOCAL_ENV_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TERM", "COLORTERM", "CI",
  "SYSTEMROOT", "COMSPEC", "PATHEXT", "DENO_DIR", "BUN_INSTALL", "XDG_CACHE_HOME", "QEP_POSTGRES_BIN", "UI_REVIEW_OUTPUT",
];
export function localOnlyChildEnv(source = process.env) {
  const env = Object.fromEntries(LOCAL_ENV_KEYS.filter(key => typeof source[key] === "string").map(key => [key, source[key]]));
  return { ...env, QEP_SKIP_LOCAL_ENV: "1", VITE_SUPABASE_URL: "https://qep-ui-test.invalid",
    VITE_SUPABASE_ANON_KEY: "isolated-fixture-anon-key-not-real", VITE_SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "", SENTRY_ORG: "", SENTRY_PROJECT: "" };
}
const shellQuote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
export function createLocalOnlyRuntime(source = process.env) {
  const env = localOnlyChildEnv(source);
  const bun = realpathSync(process.versions.bun ? process.execPath : execFileSync("which", ["bun"], { encoding: "utf8", env }).trim());
  const runs = join(homedir(), ".hermes", "tmp", "agent-runs");
  mkdirSync(runs, { recursive: true });
  const root = mkdtempSync(join(runs, "segment-local-"));
  const bin = join(root, "bin"); mkdirSync(bin);
  const files = [join(bin, "bun"), join(bin, "bunx")];
  for (const [index, path] of files.entries()) {
    writeFileSync(path, `#!/bin/sh\nexec ${shellQuote(bun)} --no-env-file ${index === 1 ? "x " : ""}"$@"\n`, { mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const manifest = join(root, "manifest.json");
  const record = artifacts => writeFileSync(manifest, JSON.stringify({ schema_version: 1, run_id: root.split("/").at(-1), created_by: "codex", artifacts }, null, 2), { mode: 0o600 });
  record(files);
  env.PATH = `${bin}:${env.PATH ?? "/usr/bin:/bin"}`;
  return { env, manifest, cleanup() {
    const result = spawnSync("jarvis-storage-steward", ["cleanup-run", "--manifest", manifest], { encoding: "utf8", env });
    if (result.status !== 0) return `Runtime shims retained under recorded manifest: ${manifest}`;
    for (const path of files) if (existsSync(path)) unlinkSync(path);
    rmdirSync(bin); record([]); return null;
  } };
}
export function verificationScope(localOnly) {
  return localOnly ? {
    kind: "isolated_local_technical_verification", local_only: true, operational_acceptance: false,
    label: "Isolated local technical checks only; no operational acceptance",
    exclusions: ["hosted KB retrieval/integration/workspace isolation", "production deployment", "live customer/provider acceptance", "physical-device UAT", "business rollout approval"],
    environment: { inherited_variables: "explicit allowlist; inherited service/provider secrets excluded", bun_dotenv: "disabled for PATH-invoked bun/bunx and explicit no-env-file test children", filesystem_sandbox: false, network_sandbox: false,
      limitation: "Not a filesystem or network sandbox: arbitrary test code and non-Bun tools can still read files or host credential stores. No claim of universal secret-file isolation." },
  } : { kind: "configured_registered_gate_chain", local_only: false, operational_acceptance: false,
    label: "Configured registered gate chain; operational acceptance requires separate owner/UAT approval",
    exclusions: ["automatic business rollout approval"] };
}
export function designArtifacts(localOnly, ui, repoRoot, env = process.env) {
  if (!localOnly) return ["/tmp/qep-design-review-report.json", "/tmp/qep-mobile-admin-rep-redirect.png", "test-results/design-review/floor-desktop.png", "test-results/design-review/floor-mobile.png"];
  if (!ui) return [];
  const output = resolve(env.UI_REVIEW_OUTPUT ?? join(repoRoot, "test-results", "isolated-ui"));
  const report = join(output, "report.json");
  const artifacts = [report];
  if (existsSync(report)) {
    const document = JSON.parse(readFileSync(report, "utf8"));
    for (const result of document.results ?? []) for (const name of result.screenshots ?? []) {
      const path = resolve(output, name);
      if (path.startsWith(output + "/") && existsSync(path)) artifacts.push(path);
    }
  }
  return [...new Set(artifacts)];
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

async function runCommand({ id, command, cwd, repoRoot, env }) {
  logCheckStart({ id, command, cwd, repoRoot });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd,
      env,
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

export function buildGateReport(options, checks, reportTimestamp, repoRoot, childEnv = process.env, runtime = null, cleanupWarning = null) {
  const blockingFailures = checks.filter(check => check.required && check.status === "fail");
  const verdict = blockingFailures.length ? "FAIL" : "PASS";
  const scope = verificationScope(options.localOnly);
return {
  segment: options.segment,
  agent: "segment_gate_runner",
  timestamp: reportTimestamp,
  verdict,
  local_only: options.localOnly,
  verification_scope: scope,
  operational_acceptance: false,
  ...(runtime ? { isolation_manifest: runtime.manifest, isolation_cleanup_warning: cleanupWarning } : {}),
  mission_alignment: {
    verdict: "pass",
    evidence:
      options.localOnly
        ? `Segment ${options.segment} ran isolated local technical checks and, when requested, the source-bound synthetic UI review. Hosted KB checks were excluded. This result supports remediation verification, not customer, provider, physical-device or operational acceptance.`
        : `Segment ${options.segment} ran through the registered QEP gate chain under the mission lock: equipment/parts/sales/rental operator utility, pressure testing, and release-gate review before closure.`,
    risk:
      "Automated command gates do not replace product judgment; release_gate_agent must still confirm surface-specific mission fit and any waiver before segment closure.",
  },
  options: {
    ui: options.ui,
    chaos: options.chaos,
    design_advisory: options.designAdvisory,
    local_only: options.localOnly,
  },
  checks,
  summary: {
    total: checks.length,
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    blocking_failures: blockingFailures.map((check) => check.id),
  },
  artifacts: designArtifacts(options.localOnly, options.ui, repoRoot, childEnv),
};
}

export async function main(argv = process.argv.slice(2)) {
const options = parseArgs(argv);
const repoRoot = process.cwd();
if (!options.localOnly) loadLocalEnv(repoRoot);
const runtime = options.localOnly ? createLocalOnlyRuntime() : null;
const childEnv = runtime?.env ?? process.env;
const scope = verificationScope(options.localOnly);
console.log(`verification scope: ${scope.label}`);
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

  const result = await runCommand({ id, command, cwd, repoRoot, env: childEnv });
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
  id: "qa.iron-capability-audit",
  command: "bun run iron:capability-audit",
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
  command:
    "deno check supabase/functions/integration-test-connection/index.ts supabase/functions/portal-api/index.ts supabase/functions/intellidealer-customer-import/index.ts",
  required: true,
});

await pushCheck({
  id: "qa.service-engine-deno-tests",
  command:
    "deno test supabase/functions/_shared/service-engine-smoke.test.ts supabase/functions/_shared/service-hold-integrity.test.ts supabase/functions/_shared/service-vendor-inbound-auth.test.ts supabase/functions/_shared/vendor-inbound-contract.test.ts supabase/functions/_shared/vendor-escalation-resend.test.ts --allow-read --allow-env",
  required: true,
});

await pushCheck({ id: "qa.remediation-transactions-and-recovery", command: "bun --no-env-file run test:remediation", required: true });

await pushCheck({
  id: "qa.kb-retrieval-eval",
  command: "node ./scripts/kb-eval/run-eval-if-configured.mjs",
  required: !options.localOnly,
  enabled: !options.localOnly,
});

await pushCheck({
  id: "qa.kb-integration-tests",
  command: "node ./scripts/kb-eval/run-integration-if-configured.mjs",
  required: !options.localOnly,
  enabled: !options.localOnly,
});

await pushCheck({
  id: "qa.kb-workspace-isolation",
  command: "KB_ISOLATION_REQUIRED=true node ./scripts/kb-eval/workspace-isolation.mjs",
  required: !options.localOnly,
  enabled: !options.localOnly,
});

await pushCheck({
  id: "chaos.stress-suite",
  command: "bun run stress:test",
  required: options.chaos,
  enabled: options.chaos,
});

await pushCheck({
  id: "cdo.design-review",
  command: options.localOnly ? "node scripts/agent-gates/validate-isolated-ui-review.mjs" : "bun run design:review",
  required: options.ui && !options.designAdvisory,
  enabled: options.ui,
});

const cleanupWarning = runtime?.cleanup() ?? null;
if (cleanupWarning) console.warn(cleanupWarning);
const blockingFailures = checks.filter((check) => check.required && check.status === "fail");
const verdict = blockingFailures.length > 0 ? "FAIL" : "PASS";

const report = buildGateReport(options, checks, reportTimestamp, repoRoot, childEnv, runtime, cleanupWarning);

const reportPath = join(
  reportDir,
  `${tsForFilename()}-${options.segment.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`
);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`segment: ${options.segment}`);
console.log(`verdict: ${verdict}${options.localOnly ? " (isolated local technical verification only; operational acceptance excluded)" : ""}`);
console.log(`report: ${reportPath}`);
for (const check of checks) {
  console.log(summarize(check));
}

return verdict === "FAIL" ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
