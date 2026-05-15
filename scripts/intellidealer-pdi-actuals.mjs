#!/usr/bin/env bun
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { loadLocalEnv } from "./_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..");
loadLocalEnv(repoRoot);

const DEFAULT_SOURCE = "intellidealer_snapshot_2026-05-14";
const SOURCE_TAG = "intellidealer_service_history";
const PDI_TERMS = ["pdi", "prep", "pre delivery", "pre-delivery", "setup", "make ready", "make-ready"];

const FIELD_ALIASES = {
  make: ["make", "manufacturer", "equipment_make", "unit_make", "machine_make"],
  model: ["model", "equipment_model", "unit_model", "machine_model"],
  modelYear: ["model_year", "year", "equipment_year", "unit_year", "machine_year"],
  stockNumber: ["stock_number", "stock_no", "stock", "unit_stock_number", "equipment_stock_number"],
  serviceOrderNumber: ["service_order_number", "service_order", "work_order_number", "work_order", "wo_number", "ro_number", "repair_order_number"],
  completedAt: ["completed_at", "completion_date", "closed_at", "close_date", "invoice_date", "date_completed", "work_order_date"],
  cost: ["pdi_cost", "total_cost", "cost", "labor_cost", "total_labor_cost", "amount", "extended_cost", "invoice_cost"],
  description: ["description", "job_description", "labor_description", "operation_description", "complaint", "work_performed", "service_type"],
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

if (args.selfTest) {
  runSelfTest();
  process.exit(0);
}

const workspace = args.workspace ?? "default";
const source = args.source ?? DEFAULT_SOURCE;
const commit = args.commit === true;
const batchSize = Number.isFinite(Number(args.batchSize)) ? Math.max(1, Number(args.batchSize)) : 500;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  fail("Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stageRows = await loadStageRows(client, { workspace, source });
const mapped = stageRows.map((row) => mapStageRowToPdiActual(row)).filter((row) => row.actual);
const skipped = stageRows.length - mapped.length;
const preview = mapped.slice(0, 5).map(({ actual }) => ({
  make: actual.make,
  model: actual.model,
  pdi_cost: actual.pdi_cost,
  service_order_number: actual.service_order_number,
  completed_at: actual.completed_at,
}));

let inserted = 0;
if (commit && mapped.length > 0) {
  for (const batch of chunked(mapped.map(({ actual }) => actual), batchSize)) {
    const { error } = await client.from("pdi_actuals").insert(batch);
    if (error) fail(`PDI actual insert failed: ${error.message}`);
    inserted += batch.length;
  }
}

console.log(JSON.stringify({
  verdict: "PASS",
  commit,
  workspace,
  source,
  stage_rows: stageRows.length,
  eligible_pdi_rows: mapped.length,
  skipped_rows: skipped,
  inserted_rows: inserted,
  preview,
  note: commit
    ? "Inserted service-history PDI actuals into public.pdi_actuals."
    : "Dry run only. Re-run with --commit to insert public.pdi_actuals.",
}, null, 2));

export function mapStageRowToPdiActual(stageRow) {
  const payload = stageRow?.payload && typeof stageRow.payload === "object" ? stageRow.payload : {};
  const description = stringValue(firstField(payload, FIELD_ALIASES.description));
  const cost = moneyValue(firstField(payload, FIELD_ALIASES.cost));
  const make = stringValue(firstField(payload, FIELD_ALIASES.make));
  const model = stringValue(firstField(payload, FIELD_ALIASES.model));
  const serviceOrderNumber = stringValue(firstField(payload, FIELD_ALIASES.serviceOrderNumber));

  if (!looksLikePdi(payload, description)) return { actual: null, reason: "not_pdi" };
  if (!make || !model) return { actual: null, reason: "missing_make_model" };
  if (cost == null || cost < 0) return { actual: null, reason: "missing_cost" };

  const completedAt = dateValue(firstField(payload, FIELD_ALIASES.completedAt)) ?? stageRow.snapshot_loaded_at ?? new Date().toISOString();
  const sourceFileName = stringValue(stageRow.source_file_name);
  const sourceRowNumber = Number.isFinite(Number(stageRow.source_row_number)) ? Number(stageRow.source_row_number) : null;
  const notes = description || "PDI actual inferred from IntelliDealer service history.";

  return {
    actual: {
      workspace_id: stringValue(stageRow.workspace_id) || "default",
      make,
      model,
      model_year: integerValue(firstField(payload, FIELD_ALIASES.modelYear)),
      stock_number: stringValue(firstField(payload, FIELD_ALIASES.stockNumber)) || null,
      service_order_number: serviceOrderNumber || null,
      completed_at: completedAt,
      pdi_cost: cost,
      notes,
      source: SOURCE_TAG,
      metadata: {
        source: stageRow.source ?? null,
        source_dataset: stageRow.source_dataset ?? "service_history",
        source_file_name: sourceFileName || null,
        source_row_number: sourceRowNumber,
        stage_id: stageRow.id ?? null,
        description,
      },
    },
    reason: "mapped",
  };
}

function looksLikePdi(payload, description) {
  const haystack = [
    description,
    payload.service_type,
    payload.job_type,
    payload.operation_code,
    payload.op_code,
    payload.work_type,
    payload.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return PDI_TERMS.some((term) => haystack.includes(term));
}

async function loadStageRows(client, { workspace, source }) {
  const allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from("qrm_intellidealer_service_history_stage")
      .select("id,workspace_id,source,source_dataset,source_file_name,source_row_number,snapshot_loaded_at,payload")
      .eq("workspace_id", workspace)
      .eq("source", source)
      .order("source_file_name", { ascending: true })
      .order("source_row_number", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) fail(`Failed to read service history stage rows: ${error.message}`);
    allRows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

function firstField(payload, aliases) {
  for (const key of aliases) {
    if (payload[key] != null && `${payload[key]}`.trim() !== "") return payload[key];
  }
  return null;
}

function stringValue(value) {
  if (value == null) return "";
  return `${value}`.trim();
}

function moneyValue(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  const normalized = `${value}`.replace(/[$,]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function integerValue(value) {
  if (value == null || `${value}`.trim() === "") return null;
  const parsed = Number.parseInt(`${value}`, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value) {
  if (value == null || `${value}`.trim() === "") return null;
  const parsed = new Date(`${value}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function* chunked(rows, size) {
  for (let index = 0; index < rows.length; index += size) {
    yield rows.slice(index, index + size);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--commit") parsed.commit = true;
    else if (arg === "--self-test") parsed.selfTest = true;
    else if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--source") parsed.source = argv[++index];
    else if (arg === "--batch-size") parsed.batchSize = argv[++index];
  }
  return parsed;
}

function runSelfTest() {
  const mapped = mapStageRowToPdiActual({
    id: "stage-1",
    workspace_id: "qep",
    source: "test",
    source_dataset: "service_history",
    source_file_name: "service.csv",
    source_row_number: 12,
    snapshot_loaded_at: "2026-05-14T00:00:00.000Z",
    payload: {
      make: "Yanmar",
      model: "VIO55",
      year: "2024",
      stock_number: "Q123",
      work_order_number: "WO-99",
      close_date: "2026-05-01",
      total_cost: "$425.50",
      description: "PDI setup and make ready",
    },
  });
  if (!mapped.actual) fail(`self-test expected mapped row, got ${mapped.reason}`);
  if (mapped.actual.pdi_cost !== 425.5) fail("self-test parsed wrong cost");
  if (mapped.actual.model_year !== 2024) fail("self-test parsed wrong model year");

  const skipped = mapStageRowToPdiActual({
    workspace_id: "qep",
    payload: { make: "Yanmar", model: "VIO55", total_cost: "100", description: "Warranty repair" },
  });
  if (skipped.actual || skipped.reason !== "not_pdi") fail("self-test expected non-PDI skip");

  console.log(JSON.stringify({ verdict: "PASS", self_test: true }, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage:
  bun ./scripts/intellidealer-pdi-actuals.mjs [--workspace default] [--source intellidealer_snapshot_2026-05-14]
  bun ./scripts/intellidealer-pdi-actuals.mjs --commit [--workspace default] [--source intellidealer_snapshot_2026-05-14]
  bun ./scripts/intellidealer-pdi-actuals.mjs --self-test

Maps staged IntelliDealer service-history rows that look like PDI/prep/setup/make-ready work into public.pdi_actuals.
Dry-run is the default; --commit requires SUPABASE_SERVICE_ROLE_KEY.`);
}
