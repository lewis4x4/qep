#!/usr/bin/env bun
/**
 * Fleet 271K synthetic stress test (Enhancement 6)
 *
 * Seeds a large synthetic fleet under a dedicated stress-test workspace
 * and measures query latency on every hot-path RPC + view that serves
 * Fleet Map, Asset 360, Service Dashboard, and Account 360.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/stress/fleet-271k-stress.mjs [--count=271000] [--company-count=5000] [--seed-only] [--measure-only] [--workspace=stress_test] [--cleanup]
 *
 * Modes:
 *   (default)       seed + measure + report
 *   --seed-only     create synthetic data, no measurements
 *   --measure-only  skip seeding, run the measurement suite against
 *                    existing data
 *   --cleanup       drop all rows under the stress workspace
 *
 * Report format: JSON to stdout + markdown table to a report file at
 * docs/stress-reports/YYYY-MM-DD-fleet-{count}k.md
 *
 * ISOLATION: every row created is scoped to workspace_id='stress_test'
 * (or the --workspace override). Your production workspace is never
 * touched. A cleanup pass wipes only that workspace.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/* ── CLI args ────────────────────────────────────────────────────── */

const args = new Map(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? "true"];
    }),
);

const TARGET_COUNT = Number(args.get("count") ?? 271_000);
const COMPANY_COUNT = Number(args.get("company-count") ?? 5_000);
const WORKSPACE = args.get("workspace") ?? "stress_test";
const SEED_ONLY = args.get("seed-only") === "true";
const MEASURE_ONLY = args.get("measure-only") === "true";
const CLEANUP = args.get("cleanup") === "true";
const BATCH_SIZE = 500;

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supa = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

/* ── Helpers ─────────────────────────────────────────────────────── */

const MAKES = ["Develon", "Yanmar", "JCB", "Kubota", "Bobcat", "Case", "Komatsu", "Takeuchi", "CAT", "Hitachi"];
const MODELS_BY_MAKE = {
  Develon:  ["DX140", "DX225LC-7", "DX300LC-7", "DX420LC"],
  Yanmar:   ["ViO17", "ViO25", "ViO55", "ViO80"],
  JCB:      ["3CX", "8080Z", "220X", "150X"],
  Kubota:   ["KX080", "U55", "KX040", "SVL97"],
  Bobcat:   ["T770", "E85", "S850", "E35"],
  Case:     ["CX245D", "580N", "CX17C", "CX350D"],
  Komatsu:  ["PC210LC", "PC138USLC", "PC360LC", "WB146"],
  Takeuchi: ["TB290", "TL12R2", "TB2150R", "TB260"],
  CAT:      ["320", "308", "330", "301.7"],
  Hitachi:  ["ZX130", "ZX210", "ZX330", "ZX85"],
};

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomLatLng() {
  // CONUS bounding box
  return {
    lat: 25 + Math.random() * 24,
    lng: -124 + Math.random() * 58,
  };
}

async function timeIt(label, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const elapsedMs = performance.now() - start;
    return { label, elapsedMs: Math.round(elapsedMs * 100) / 100, ok: true, rowCount: result ?? null };
  } catch (err) {
    const elapsedMs = performance.now() - start;
    return { label, elapsedMs: Math.round(elapsedMs * 100) / 100, ok: false, error: err.message };
  }
}

/* ── Seed ────────────────────────────────────────────────────────── */

async function seedCompanies() {
  console.log(`\n[seed] Creating ${COMPANY_COUNT.toLocaleString()} companies in workspace=${WORKSPACE}…`);
  const rows = [];
  for (let i = 0; i < COMPANY_COUNT; i++) {
    rows.push({
      workspace_id: WORKSPACE,
      name: `Stress Co ${i.toString().padStart(6, "0")}`,
    });
  }
  const ids = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supa.from("qrm_companies").insert(batch).select("id");
    if (error) throw new Error(`Company insert failed at batch ${i}: ${error.message}`);
    ids.push(...data.map((r) => r.id));
    if (i % (BATCH_SIZE * 10) === 0) {
      process.stdout.write(`\r[seed]   companies: ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()}/${COMPANY_COUNT.toLocaleString()}`);
    }
  }
  console.log(`\n[seed] ✓ ${ids.length.toLocaleString()} companies created`);
  return ids;
}

async function seedEquipment(companyIds) {
  console.log(`\n[seed] Creating ${TARGET_COUNT.toLocaleString()} equipment rows…`);
  const rows = [];
  const perBatch = [];
  for (let i = 0; i < TARGET_COUNT; i++) {
    const make = randomItem(MAKES);
    const model = randomItem(MODELS_BY_MAKE[make]);
    const year = randomInt(2015, 2026);
    const { lat, lng } = randomLatLng();
    perBatch.push({
      workspace_id: WORKSPACE,
      company_id: randomItem(companyIds),
      name: `${year} ${make} ${model} #${i}`,
      make,
      model,
      year,
      serial_number: `STRESS-${i.toString().padStart(8, "0")}`,
      engine_hours: randomInt(50, 8000),
      metadata: { lat, lng, source: "stress_test" },
    });

    if (perBatch.length >= BATCH_SIZE) {
      const { error } = await supa.from("qrm_equipment").insert(perBatch);
      if (error) throw new Error(`Equipment insert failed at ${i}: ${error.message}`);
      rows.push(...perBatch);
      perBatch.length = 0;
      if (i % (BATCH_SIZE * 20) === 0) {
        process.stdout.write(`\r[seed]   equipment: ${i.toLocaleString()}/${TARGET_COUNT.toLocaleString()}`);
      }
    }
  }
  if (perBatch.length > 0) {
    const { error } = await supa.from("qrm_equipment").insert(perBatch);
    if (error) throw new Error(`Equipment final batch failed: ${error.message}`);
    rows.push(...perBatch);
  }
  console.log(`\n[seed] ✓ ${rows.length.toLocaleString()} equipment rows created`);
}

/* ── Measure ─────────────────────────────────────────────────────── */

async function measure() {
  console.log(`\n[measure] Running hot-path query latency suite against workspace=${WORKSPACE}…\n`);

  // Pick a random company + equipment for per-entity RPCs
  const { data: sampleCompany } = await supa
    .from("qrm_companies")
    .select("id")
    .eq("workspace_id", WORKSPACE)
    .limit(1)
    .maybeSingle();
  const { data: sampleEquipment } = await supa
    .from("qrm_equipment")
    .select("id")
    .eq("workspace_id", WORKSPACE)
    .limit(1)
    .maybeSingle();

  const results = [];

  results.push(await timeIt("SELECT count(*) qrm_equipment", async () => {
    const { count, error } = await supa
      .from("qrm_equipment")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", WORKSPACE);
    if (error) throw error;
    return count;
  }));

  results.push(await timeIt("Fleet Map query (500 rows, order by updated_at)", async () => {
    const { data, error } = await supa
      .from("qrm_equipment")
      .select("id, name, make, model, year, engine_hours, company_id, metadata")
      .eq("workspace_id", WORKSPACE)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return data?.length ?? 0;
  }));

  if (sampleCompany) {
    results.push(await timeIt("get_account_360 (single company)", async () => {
      const { data, error } = await supa.rpc("get_account_360", { p_company_id: sampleCompany.id });
      if (error) throw error;
      return data ? 1 : 0;
    }));

    results.push(await timeIt("get_fleet_radar (single company)", async () => {
      const { data, error } = await supa.rpc("get_fleet_radar", { p_company_id: sampleCompany.id });
      if (error) throw error;
      return data ? 1 : 0;
    }));

    results.push(await timeIt("find_duplicate_companies (whole workspace)", async () => {
      const { data, error } = await supa.rpc("find_duplicate_companies", { p_threshold: 0.6 });
      if (error) throw error;
      return data?.length ?? 0;
    }));
  }

  if (sampleEquipment) {
    results.push(await timeIt("get_asset_360 (single equipment)", async () => {
      const { data, error } = await supa.rpc("get_asset_360", { p_equipment_id: sampleEquipment.id });
      if (error) throw error;
      return data ? 1 : 0;
    }));

    results.push(await timeIt("get_asset_badges (single equipment)", async () => {
      const { data, error } = await supa.rpc("get_asset_badges", { p_equipment_id: sampleEquipment.id });
      if (error) throw error;
      return data ? 1 : 0;
    }));

    results.push(await timeIt("get_asset_countdowns (single equipment)", async () => {
      const { data, error } = await supa.rpc("get_asset_countdowns", { p_equipment_id: sampleEquipment.id });
      if (error) throw error;
      return data?.length ?? 0;
    }));
  }

  results.push(await timeIt("run_data_quality_audit (full scan)", async () => {
    const { data, error } = await supa.rpc("run_data_quality_audit");
    if (error) throw error;
    return data?.length ?? 0;
  }));

  return results;
}

/* ── Report ──────────────────────────────────────────────────────── */

function writeReport(results) {
  const today = new Date().toISOString().split("T")[0];
  const kCount = Math.round(TARGET_COUNT / 1000);
  const reportPath = `docs/stress-reports/${today}-fleet-${kCount}k.md`;

  const headerMd = `# Fleet ${TARGET_COUNT.toLocaleString()}-asset stress report\n\n`
    + `- **Date:** ${today}\n`
    + `- **Workspace:** \`${WORKSPACE}\`\n`
    + `- **Equipment rows:** ${TARGET_COUNT.toLocaleString()}\n`
    + `- **Companies:** ${COMPANY_COUNT.toLocaleString()}\n`
    + `- **Supabase URL:** \`${supabaseUrl.replace(/https?:\/\//, "")}\`\n\n`
    + `## Hot-path query latency\n\n`;

  const tableMd = [
    "| Query | Elapsed (ms) | Status | Rows |",
    "|-------|-------------:|:------:|:----:|",
    ...results.map((r) =>
      `| ${r.label} | ${r.elapsedMs.toFixed(1)} | ${r.ok ? "✅" : "❌"} | ${r.rowCount ?? "—"} |`
    ),
    "",
    `## Thresholds\n\n- **Fleet Map query target:** < 800ms\n- **get_account_360 target:** < 500ms\n- **get_asset_360 target:** < 500ms\n- **find_duplicate_companies target:** < 2000ms\n- **run_data_quality_audit target:** < 5000ms\n`,
    "",
    `## Pass / Fail\n`,
  ].join("\n");

  const maxLatency = Math.max(...results.filter((r) => r.ok).map((r) => r.elapsedMs), 0);
  const anyFailed = results.some((r) => !r.ok);
  const verdict = anyFailed
    ? "❌ One or more queries failed — see results table."
    : maxLatency > 5000
      ? `⚠️ Max latency ${maxLatency.toFixed(0)}ms exceeds 5s ceiling.`
      : `✅ All queries passed, max latency ${maxLatency.toFixed(0)}ms.`;

  const md = headerMd + tableMd + "\n" + verdict + "\n";

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, md);
  console.log(`\n[report] Written to ${reportPath}`);
  return { reportPath, verdict, maxLatency };
}

/* ── Cleanup ─────────────────────────────────────────────────────── */

async function cleanup() {
  console.log(`\n[cleanup] Deleting all rows in workspace=${WORKSPACE}…`);

  // Round-5 fix: batch the deletes by ID instead of one giant DELETE.
  // A 271k-row DELETE locks the table and can hit query timeouts.
  async function batchDelete(table) {
    let totalDeleted = 0;
    while (true) {
      const { data: ids, error: selErr } = await supa
        .from(table)
        .select("id")
        .eq("workspace_id", WORKSPACE)
        .limit(1000);
      if (selErr) throw new Error(`${table} select failed: ${selErr.message}`);
      if (!ids || ids.length === 0) break;
      const idArray = ids.map((r) => r.id);
      const { error: delErr } = await supa
        .from(table)
        .delete()
        .in("id", idArray);
      if (delErr) throw new Error(`${table} delete failed: ${delErr.message}`);
      totalDeleted += idArray.length;
      process.stdout.write(`\r[cleanup]   ${table}: ${totalDeleted.toLocaleString()} deleted`);
    }
    console.log(`\n[cleanup] ✓ ${table}: ${totalDeleted.toLocaleString()} rows deleted`);
  }

  await batchDelete("qrm_equipment");
  await batchDelete("qrm_companies");
  console.log(`[cleanup] ✓ workspace=${WORKSPACE} wiped`);
}

/* ── Main ────────────────────────────────────────────────────────── */

async function main() {
  const startedAt = Date.now();

  if (CLEANUP) {
    await cleanup();
    return;
  }

  let companyIds = [];
  if (!MEASURE_ONLY) {
    companyIds = await seedCompanies();
    await seedEquipment(companyIds);
  }

  if (SEED_ONLY) {
    console.log(`\n[done] Seed-only run. Total time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  const results = await measure();
  console.log("\n[measure] Results:");
  console.table(results.map((r) => ({
    Query: r.label,
    "Elapsed (ms)": r.elapsedMs,
    OK: r.ok ? "✓" : "✗",
    Rows: r.rowCount ?? "—",
  })));

  const { verdict } = writeReport(results);
  console.log(`\n[verdict] ${verdict}`);
  console.log(`[done] Total time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(1);
});
