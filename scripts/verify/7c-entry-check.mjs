#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
loadLocalEnv(repoRoot);

function usage() {
  console.log(`Usage:
  bun scripts/verify/7c-entry-check.mjs [--workspace=default] [--days=365] [--as-of=YYYY-MM-DD] [--json]

Checks whether the Honesty Calibration rollup history is strong enough to open 7C.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

if (args.has("help")) {
  usage();
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running the 7C entry check.");
  usage();
  process.exit(1);
}

const workspaceId = args.get("workspace") ?? "default";
const requiredDays = Number(args.get("days") ?? "365");
const asOfRaw = args.get("as-of");
const asOfDate = asOfRaw ? new Date(`${asOfRaw}T00:00:00.000Z`) : new Date();
if (Number.isNaN(asOfDate.getTime())) {
  console.error(`Invalid --as-of date: ${asOfRaw}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const aMs = Date.parse(`${a}T00:00:00.000Z`);
  const bMs = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((bMs - aMs) / 86_400_000);
}

const { data, error } = await supabase
  .from("qrm_honesty_daily")
  .select("rollup_date, honesty_index")
  .eq("workspace_id", workspaceId)
  .order("rollup_date", { ascending: true });

if (error) {
  console.error(`Failed to query qrm_honesty_daily: ${error.message}`);
  process.exit(1);
}

const rows = data ?? [];
const dates = rows.map((row) => row.rollup_date);
const firstRollupDate = dates[0] ?? null;
const latestRollupDate = dates[dates.length - 1] ?? null;
const cutoffDate = new Date(asOfDate);
cutoffDate.setUTCDate(cutoffDate.getUTCDate() - requiredDays);
const cutoffDay = isoDay(cutoffDate);

let maxGapDays = 0;
let missingDayCount = 0;
for (let i = 1; i < dates.length; i += 1) {
  const gap = daysBetween(dates[i - 1], dates[i]);
  if (gap > 1) {
    missingDayCount += gap - 1;
    maxGapDays = Math.max(maxGapDays, gap - 1);
  }
}

const observedDays = dates.length;
const minimumAcceptableDays = Math.max(requiredDays - 35, 0);
const firstDateSatisfied = firstRollupDate != null && firstRollupDate <= cutoffDay;
const continuitySatisfied = observedDays >= minimumAcceptableDays && maxGapDays <= 7;
const fullFiscalYearEvidenced = firstDateSatisfied && continuitySatisfied;

const result = {
  workspace_id: workspaceId,
  as_of_date: isoDay(asOfDate),
  required_days: requiredDays,
  cutoff_date: cutoffDay,
  first_rollup_date: firstRollupDate,
  latest_rollup_date: latestRollupDate,
  observed_days: observedDays,
  minimum_acceptable_days: minimumAcceptableDays,
  missing_day_count: missingDayCount,
  max_gap_days: maxGapDays,
  continuity_satisfied: continuitySatisfied,
  first_date_satisfied: firstDateSatisfied,
  full_fiscal_year_evidenced: fullFiscalYearEvidenced,
};

if (args.has("json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`7C entry check for workspace=${workspaceId}`);
  console.log(`as-of: ${result.as_of_date}`);
  console.log(`first rollup: ${result.first_rollup_date ?? "none"}`);
  console.log(`latest rollup: ${result.latest_rollup_date ?? "none"}`);
  console.log(`observed days: ${result.observed_days}`);
  console.log(`missing days across timeline: ${result.missing_day_count}`);
  console.log(`largest gap: ${result.max_gap_days} day(s)`);
  console.log(`first-date satisfied: ${result.first_date_satisfied ? "yes" : "no"}`);
  console.log(`continuity satisfied: ${result.continuity_satisfied ? "yes" : "no"}`);
  console.log(`full fiscal year evidenced: ${result.full_fiscal_year_evidenced ? "yes" : "no"}`);
}

process.exit(result.full_fiscal_year_evidenced ? 0 : 2);
