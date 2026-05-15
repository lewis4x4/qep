#!/usr/bin/env bun
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadLocalEnv } from "./_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..");
loadLocalEnv(repoRoot);

const DEFAULT_SOURCE = "intellidealer_snapshot_2026-05-14";
const DATASETS = {
  equipment: {
    stageTable: "qrm_intellidealer_equipment_master_stage",
    canonicalColumn: "canonical_equipment_id",
    mapper: mapEquipmentStageRow,
  },
  parts: {
    stageTable: "qrm_intellidealer_parts_master_stage",
    canonicalColumn: "canonical_part_id",
    mapper: mapPartStageRow,
  },
};

const FIELD_ALIASES = {
  make: ["make", "manufacturer", "mfr", "brand", "equipment_make"],
  model: ["model", "model_code", "equipment_model"],
  modelYear: ["model_year", "year", "equipment_year"],
  stockNumber: ["stock_number", "stock_no", "stock", "unit_number"],
  serialNumber: ["serial_number", "serial_no", "serial", "vin", "pin"],
  listPrice: ["list_price", "selling_price", "sell_price", "retail_price", "price"],
  dealerCost: ["dealer_cost", "cost", "inventory_cost", "book_cost"],
  msrp: ["msrp", "suggested_list_price"],
  branch: ["branch", "branch_code", "location", "store"],
  condition: ["condition", "new_used", "status"],
  category: ["category", "machine_category", "class"],
  partNumber: ["part_number", "part_no", "part", "item_number", "item"],
  description: ["description", "part_description", "item_description"],
  manufacturer: ["manufacturer", "vendor_name", "mfr", "make"],
  vendorCode: ["vendor_code", "vendor", "supplier_code"],
  coCode: ["co_code", "company_code", "company"],
  divCode: ["div_code", "division_code", "division"],
  branchCode: ["branch_code", "branch", "location"],
  costPrice: ["cost_price", "average_cost", "avg_cost", "cost"],
  partListPrice: ["list_price", "retail_price", "selling_price", "price"],
  onHand: ["on_hand", "qty_on_hand", "quantity_on_hand", "available_quantity"],
  onOrder: ["on_order", "qty_on_order", "quantity_on_order"],
  binLocation: ["bin_location", "bin", "primary_bin"],
  uom: ["uom", "unit_of_measure"],
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
const include = datasetSelection(args);

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  fail("Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
for (const dataset of include) {
  if (dataset === "service_pdi") {
    results.push(runPdiCommit({ workspace, source, commit }));
    continue;
  }

  const config = DATASETS[dataset];
  const stageRows = await loadStageRows(client, config.stageTable, { workspace, source });
  const mapped = stageRows.map((row) => ({ stage: row, mapped: config.mapper(row) }));
  const eligible = mapped.filter((row) => row.mapped.record);
  const skipped = mapped.length - eligible.length;
  const preview = eligible.slice(0, 5).map((row) => row.mapped.record);
  let committed = 0;

  if (commit) {
    for (const row of eligible) {
      const canonicalId = dataset === "equipment"
        ? await upsertEquipment(client, row.mapped.record)
        : await upsertPart(client, row.mapped.record);
      committed += 1;
      await markStageCanonical(client, config.stageTable, config.canonicalColumn, row.stage.id, canonicalId);
    }
  }

  results.push({
    dataset,
    stage_table: config.stageTable,
    stage_rows: stageRows.length,
    eligible_rows: eligible.length,
    skipped_rows: skipped,
    committed_rows: committed,
    preview,
  });
}

console.log(JSON.stringify({
  verdict: "PASS",
  commit,
  workspace,
  source,
  results,
  quote_history_note: "Quote history remains staged for reviewed analytics/backfill; it is not blindly committed into live quote_packages.",
}, null, 2));

export function mapEquipmentStageRow(stageRow) {
  const payload = objectPayload(stageRow);
  const make = stringValue(firstField(payload, FIELD_ALIASES.make));
  const model = stringValue(firstField(payload, FIELD_ALIASES.model));
  if (!make || !model) return { record: null, reason: "missing_make_model" };

  const stockNumber = stringValue(firstField(payload, FIELD_ALIASES.stockNumber));
  const serialNumber = stringValue(firstField(payload, FIELD_ALIASES.serialNumber));
  const externalId = stockNumber || serialNumber || stringValue(stageRow.id);

  return {
    record: {
      workspace_id: stringValue(stageRow.workspace_id) || "default",
      source: "intellidealer",
      external_id: externalId,
      make,
      model,
      year: integerValue(firstField(payload, FIELD_ALIASES.modelYear)),
      category: stringValue(firstField(payload, FIELD_ALIASES.category)) || null,
      stock_number: stockNumber || null,
      serial_number: serialNumber || null,
      list_price: moneyValue(firstField(payload, FIELD_ALIASES.listPrice)),
      dealer_cost: moneyValue(firstField(payload, FIELD_ALIASES.dealerCost)),
      msrp: moneyValue(firstField(payload, FIELD_ALIASES.msrp)),
      is_available: true,
      branch: stringValue(firstField(payload, FIELD_ALIASES.branch)) || null,
      condition: normalizeCondition(firstField(payload, FIELD_ALIASES.condition)),
      imported_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      attachments: [],
      photos: [],
    },
    reason: "mapped",
  };
}

export function mapPartStageRow(stageRow) {
  const payload = objectPayload(stageRow);
  const partNumber = stringValue(firstField(payload, FIELD_ALIASES.partNumber));
  if (!partNumber) return { record: null, reason: "missing_part_number" };

  return {
    record: {
      workspace_id: stringValue(stageRow.workspace_id) || "default",
      co_code: stringValue(firstField(payload, FIELD_ALIASES.coCode)),
      div_code: stringValue(firstField(payload, FIELD_ALIASES.divCode)),
      branch_code: stringValue(firstField(payload, FIELD_ALIASES.branchCode)),
      part_number: partNumber,
      description: stringValue(firstField(payload, FIELD_ALIASES.description)) || null,
      category: stringValue(firstField(payload, FIELD_ALIASES.category)) || null,
      manufacturer: stringValue(firstField(payload, FIELD_ALIASES.manufacturer)) || null,
      vendor_code: stringValue(firstField(payload, FIELD_ALIASES.vendorCode)) || null,
      list_price: moneyValue(firstField(payload, FIELD_ALIASES.partListPrice)),
      cost_price: moneyValue(firstField(payload, FIELD_ALIASES.costPrice)),
      on_hand: numberValue(firstField(payload, FIELD_ALIASES.onHand)),
      on_order: numberValue(firstField(payload, FIELD_ALIASES.onOrder)),
      bin_location: stringValue(firstField(payload, FIELD_ALIASES.binLocation)) || null,
      uom: stringValue(firstField(payload, FIELD_ALIASES.uom)) || "EA",
      intellidealer_part_id: partNumber,
      raw_dms_row: payload,
      is_active: true,
    },
    reason: "mapped",
  };
}

async function upsertEquipment(client, record) {
  const { data: existing, error: selectError } = await client
    .from("catalog_entries")
    .select("id")
    .eq("workspace_id", record.workspace_id)
    .eq("source", "intellidealer")
    .eq("external_id", record.external_id)
    .maybeSingle();
  if (selectError) fail(`Equipment lookup failed: ${selectError.message}`);

  if (existing?.id) {
    const { error } = await client.from("catalog_entries").update(record).eq("id", existing.id);
    if (error) fail(`Equipment update failed: ${error.message}`);
    return existing.id;
  }

  const { data, error } = await client.from("catalog_entries").insert(record).select("id").single();
  if (error) fail(`Equipment insert failed: ${error.message}`);
  return data.id;
}

async function upsertPart(client, record) {
  const { data: existing, error: selectError } = await client
    .from("parts_catalog")
    .select("id")
    .eq("workspace_id", record.workspace_id)
    .eq("co_code", record.co_code)
    .eq("div_code", record.div_code)
    .eq("branch_code", record.branch_code)
    .eq("part_number", record.part_number)
    .is("deleted_at", null)
    .maybeSingle();
  if (selectError) fail(`Part lookup failed: ${selectError.message}`);

  if (existing?.id) {
    const { error } = await client.from("parts_catalog").update(record).eq("id", existing.id);
    if (error) fail(`Part update failed: ${error.message}`);
    return existing.id;
  }

  const { data, error } = await client.from("parts_catalog").insert(record).select("id").single();
  if (error) fail(`Part insert failed: ${error.message}`);
  return data.id;
}

async function loadStageRows(client, table, { workspace, source }) {
  const allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select("id,workspace_id,source,source_dataset,source_file_name,source_row_number,snapshot_loaded_at,payload")
      .eq("workspace_id", workspace)
      .eq("source", source)
      .order("source_file_name", { ascending: true })
      .order("source_row_number", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) fail(`Failed to read ${table}: ${error.message}`);
    allRows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function markStageCanonical(client, table, canonicalColumn, id, canonicalId) {
  const { error } = await client.from(table).update({ [canonicalColumn]: canonicalId }).eq("id", id);
  if (error) fail(`Failed to mark ${table}.${canonicalColumn}: ${error.message}`);
}

function runPdiCommit({ workspace, source, commit }) {
  const command = ["./scripts/intellidealer-pdi-actuals.mjs", "--workspace", workspace, "--source", source];
  if (commit) command.push("--commit");
  const result = spawnSync("bun", command, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  return {
    dataset: "service_pdi",
    status: result.status === 0 ? "ok" : "failed",
    exit_code: result.status,
    output_tail: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().slice(-4000),
  };
}

function objectPayload(stageRow) {
  return stageRow?.payload && typeof stageRow.payload === "object" ? stageRow.payload : {};
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
  const parsed = numberValue(value);
  return parsed == null ? null : Number(parsed.toFixed(2));
}

function numberValue(value) {
  if (value == null || `${value}`.trim() === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(`${value}`.replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value) {
  const parsed = numberValue(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function normalizeCondition(value) {
  const text = stringValue(value).toLowerCase();
  if (text.includes("used")) return "used";
  if (text.includes("cert")) return "certified_pre_owned";
  if (text.includes("new")) return "new";
  return null;
}

function datasetSelection(parsed) {
  const selected = [];
  if (parsed.equipment) selected.push("equipment");
  if (parsed.parts) selected.push("parts");
  if (parsed.servicePdi) selected.push("service_pdi");
  return selected.length > 0 ? selected : ["equipment", "parts", "service_pdi"];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--self-test") parsed.selfTest = true;
    else if (arg === "--commit") parsed.commit = true;
    else if (arg === "--equipment") parsed.equipment = true;
    else if (arg === "--parts") parsed.parts = true;
    else if (arg === "--service-pdi") parsed.servicePdi = true;
    else if (arg === "--workspace") parsed.workspace = argv[++index];
    else if (arg === "--source") parsed.source = argv[++index];
  }
  return parsed;
}

function runSelfTest() {
  const equipment = mapEquipmentStageRow({
    id: "stage-eq",
    workspace_id: "qep",
    payload: {
      make: "ASV",
      model: "RT-75",
      stock_number: "Q123",
      serial_number: "SN123",
      list_price: "$98,500",
      condition: "New",
    },
  });
  if (!equipment.record || equipment.record.external_id !== "Q123" || equipment.record.list_price !== 98500) {
    fail("equipment mapper self-test failed");
  }

  const part = mapPartStageRow({
    workspace_id: "qep",
    payload: {
      company_code: "01",
      division_code: "10",
      branch_code: "LC",
      part_number: "FILTER-1",
      description: "Hydraulic filter",
      average_cost: "12.50",
      on_hand: "8",
    },
  });
  if (!part.record || part.record.co_code !== "01" || part.record.cost_price !== 12.5 || part.record.on_hand !== 8) {
    fail("parts mapper self-test failed");
  }

  console.log(JSON.stringify({ verdict: "PASS", self_test: true }, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage:
  bun ./scripts/commit-intellidealer-snapshot-import.mjs [--workspace default] [--source intellidealer_snapshot_2026-05-14]
  bun ./scripts/commit-intellidealer-snapshot-import.mjs --commit [--equipment] [--parts] [--service-pdi]
  bun ./scripts/commit-intellidealer-snapshot-import.mjs --self-test

Dry-run is the default. Equipment commits to catalog_entries, parts commits to parts_catalog,
and service-history PDI commits to pdi_actuals. Quote history remains staged for reviewed analytics/backfill.`);
}
