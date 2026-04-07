#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const outputDir = join(repoRoot, "test-results", "kb-eval");
const latestPath = join(outputDir, "latest.json");
const baselinePath = join(outputDir, "baseline.json");

if (!existsSync(latestPath)) {
  console.error(`kb:eval:report missing latest run at ${latestPath}`);
  process.exit(1);
}

const latest = JSON.parse(readFileSync(latestPath, "utf8"));
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : null;

console.log(`Latest run: ${latest.generated_at}`);
console.log(`Pass rate: ${latest.summary.passed}/${latest.summary.total}`);

if (!baseline) {
  console.log("No baseline file found; run with KB_EVAL_WRITE_BASELINE=true to create one.");
  process.exit(0);
}

const baselineById = new Map((baseline.results ?? []).map((result) => [result.id, result]));
const regressions = [];

for (const result of latest.results ?? []) {
  const prior = baselineById.get(result.id);
  if (prior && prior.pass && !result.pass) {
    regressions.push(result.id);
  }
}

console.log(`Baseline run: ${baseline.generated_at}`);
console.log(`Regressions: ${regressions.length}`);
for (const id of regressions) {
  console.log(` - ${id}`);
}

if (regressions.length > 0) {
  process.exit(1);
}
