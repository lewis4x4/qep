#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..");
loadLocalEnv(repoRoot);

const DATASETS = [
  { id: "equipment_master", table: "qrm_intellidealer_equipment_master_stage" },
  { id: "quotes_history", table: "qrm_intellidealer_quotes_history_stage" },
  { id: "parts_master", table: "qrm_intellidealer_parts_master_stage" },
  { id: "service_history", table: "qrm_intellidealer_service_history_stage" },
];

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const workspace = args.workspace ?? "default";
const source = args.source ?? "intellidealer_snapshot_2026-05-14";

if (args.jsonlDir) {
  const result = verifyJsonl(resolve(repoRoot, args.jsonlDir), source);
  printAndExit(result);
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  printAndExit({
    verdict: "FAIL",
    reason: "Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --jsonl-dir for dry-run output verification.",
  });
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [];
for (const dataset of DATASETS) {
  const { count, error } = await client
    .from(dataset.table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace)
    .eq("source", source);

  checks.push({
    dataset: dataset.id,
    table: dataset.table,
    rows: count ?? 0,
    ok: !error && Number(count ?? 0) > 0,
    error: error?.message ?? null,
  });
}

printAndExit({
  verdict: checks.every((check) => check.ok) ? "PASS" : "FAIL",
  mode: "remote_stage_tables",
  workspace,
  source,
  checks,
});

function verifyJsonl(jsonlDir, sourceTag) {
  const checks = DATASETS.map((dataset) => {
    const filePath = resolve(jsonlDir, `${dataset.id}.jsonl`);
    if (!existsSync(filePath)) {
      return { dataset: dataset.id, file: filePath, rows: 0, ok: false, error: "missing jsonl output" };
    }
    const lines = readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    let valid = 0;
    let firstError = null;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.source === sourceTag && parsed.payload && typeof parsed.payload === "object") {
          valid += 1;
        }
      } catch (error) {
        firstError = error instanceof Error ? error.message : "invalid json";
        break;
      }
    }
    return {
      dataset: dataset.id,
      file: filePath,
      rows: lines.length,
      valid_rows: valid,
      ok: lines.length > 0 && valid === lines.length && !firstError,
      error: firstError,
    };
  });

  return {
    verdict: checks.every((check) => check.ok) ? "PASS" : "FAIL",
    mode: "jsonl",
    source: sourceTag,
    checks,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--source") parsed.source = argv[++index];
    else if (arg === "--jsonl-dir") parsed.jsonlDir = argv[++index];
  }
  return parsed;
}

function printAndExit(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verdict === "PASS" ? 0 : 1);
}

function printUsage() {
  console.log(`Usage:
  bun ./scripts/verify-intellidealer-snapshot-stage.mjs [--workspace default] [--source intellidealer_snapshot_2026-05-14]
  bun ./scripts/verify-intellidealer-snapshot-stage.mjs --jsonl-dir tmp/intellidealer-stage
`);
}
