#!/usr/bin/env bun
/**
 * Ensures scheduled service workers call logServiceCronRun on POST (cron) paths
 * so service_cron_runs stays useful for ops.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function mustContain(fileRel, needle, label) {
  const path = join(root, fileRel);
  const text = readFileSync(path, "utf8");
  if (!text.includes(needle)) {
    console.error(`FAIL: ${label} — missing "${needle}" in ${fileRel}`);
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

mustContain(
  "supabase/functions/service-tat-monitor/index.ts",
  "logServiceCronRun",
  "service-tat-monitor logs cron runs",
);
mustContain(
  "supabase/functions/service-stage-enforcer/index.ts",
  "logServiceCronRun",
  "service-stage-enforcer logs cron runs",
);
mustContain(
  "supabase/functions/service-vendor-escalator/index.ts",
  "logServiceCronRun",
  "service-vendor-escalator logs cron runs",
);
mustContain(
  "supabase/functions/service-jobcode-learner/index.ts",
  "logServiceCronRun",
  "service-jobcode-learner logs cron runs",
);
mustContain(
  "supabase/functions/service-customer-notify-dispatch/index.ts",
  "logServiceCronRun",
  "service-customer-notify-dispatch logs cron runs",
);

console.log("service-cron-logging: all static checks passed.");
