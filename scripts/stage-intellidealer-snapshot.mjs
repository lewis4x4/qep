#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const DATASETS = [
  {
    id: "equipment",
    arg: "--equipment",
    script: "scripts/stage-intellidealer-equipment-master.py",
    table: "qrm_intellidealer_equipment_master_stage",
  },
  {
    id: "quotes",
    arg: "--quotes",
    script: "scripts/stage-intellidealer-quotes-history.py",
    table: "qrm_intellidealer_quotes_history_stage",
  },
  {
    id: "parts",
    arg: "--parts",
    script: "scripts/stage-intellidealer-parts-master.py",
    table: "qrm_intellidealer_parts_master_stage",
  },
  {
    id: "service",
    arg: "--service",
    script: "scripts/stage-intellidealer-service-history.py",
    table: "qrm_intellidealer_service_history_stage",
  },
];

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const workspace = args.workspace ?? "default";
const source = args.source ?? "intellidealer_snapshot_2026-05-14";
const commit = args.commit === true;
const outDir = args.outDir ?? "tmp/intellidealer-stage";
const results = [];

for (const dataset of DATASETS) {
  const input = args[dataset.id];
  if (!input) {
    results.push({ dataset: dataset.id, status: "skipped", reason: `missing ${dataset.arg}` });
    continue;
  }

  const commandArgs = [
    resolve(repoRoot, dataset.script),
    input,
    "--workspace",
    workspace,
    "--source",
    source,
    "--table",
    dataset.table,
    "--out",
    `${outDir}/${datasetTableFile(dataset.id)}.jsonl`,
  ];
  if (commit) commandArgs.push("--commit");

  const result = spawnSync("python3", commandArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });

  results.push({
    dataset: dataset.id,
    table: dataset.table,
    status: result.status === 0 ? "ok" : "failed",
    exit_code: result.status,
    output_tail: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().slice(-4000),
  });

  if (result.status !== 0) break;
}

const staged = results.filter((result) => result.status === "ok").length;
const failed = results.filter((result) => result.status === "failed");
const skipped = results.filter((result) => result.status === "skipped");
console.log(JSON.stringify({
  verdict: failed.length === 0 && staged > 0 ? "PASS" : "FAIL",
  commit,
  workspace,
  source,
  out_dir: outDir,
  staged,
  skipped: skipped.length,
  results,
}, null, 2));

process.exit(failed.length === 0 && staged > 0 ? 0 : 1);

function datasetTableFile(id) {
  if (id === "equipment") return "equipment_master";
  if (id === "quotes") return "quotes_history";
  if (id === "parts") return "parts_master";
  return "service_history";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--commit") parsed.commit = true;
    else if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--source") parsed.source = argv[++index];
    else if (arg === "--out-dir") parsed.outDir = argv[++index];
    else {
      const match = DATASETS.find((dataset) => dataset.arg === arg);
      if (match) parsed[match.id] = argv[++index];
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  bun ./scripts/stage-intellidealer-snapshot.mjs \\
    --equipment exports/equipment.csv \\
    --quotes exports/quotes.csv \\
    --parts exports/parts.csv \\
    --service exports/service-history.csv \\
    [--workspace default] [--commit]

At least one dataset argument is required. Without --commit, writes JSONL to tmp/intellidealer-stage.
`);
}
