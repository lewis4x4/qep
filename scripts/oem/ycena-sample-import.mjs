import { createClient } from "@supabase/supabase-js";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../_shared/local-env.mjs";
import { parseYcenaPriceBookFile } from "./ycena-price-book-parser.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SUPPORTED_BRANDS = new Set(["ASV", "Yanmar"]);
const DEFAULT_WORKSPACE_ID = "default";
const CHUNK_SIZE = 250;

function normalizeBrand(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^asv$/i.test(trimmed)) return "ASV";
  if (/^yanmar$/i.test(trimmed)) return "Yanmar";
  return null;
}

function brandKey(brand) {
  return brand.toLowerCase();
}

function canonicalBaseNumber(brand, partNumber) {
  return `${brandKey(brand)}:${partNumber}`;
}

function canonicalOptionNumber(brand, partNumber) {
  return `${brandKey(brand)}:${partNumber}`;
}

function cents(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function chunk(values, size = CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildBaseMetadata({ parsed, row }) {
  return JSON.stringify(compactObject({
    source: "ycena_sample_import",
    parent_oem: parsed.parentOem,
    brand: row.brand,
    original_part_number: row.partNumber,
    source_filename: parsed.sourceFilename,
    source_sha256: parsed.sourceSha256,
    effective_date: row.effectiveDate,
    pricing_updated_date: row.pricingUpdatedDate,
    published_date: row.publishedDate,
    page: row.page,
    dealer_discount_off_list_pct: row.dealerDiscountOffListPct,
    section: row.section,
  }));
}

export function buildYcenaSampleImportPlan(parsed, options = {}) {
  const brand = normalizeBrand(options.brand ?? parsed.brand);
  if (!brand || !SUPPORTED_BRANDS.has(brand)) {
    throw new Error(`Unsupported YCENA sample import brand: ${options.brand ?? parsed.brand}`);
  }

  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const parsedRows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const baseRows = parsedRows.filter((row) => row.targetTable === "equipment_base_codes");
  const optionRows = parsedRows.filter((row) => row.targetTable === "equipment_options");
  const baseRowsByModel = new Map();

  const baseUpserts = baseRows.map((row) => {
    const baseNumber = canonicalBaseNumber(brand, row.partNumber);
    const entry = {
      workspace_id: workspaceId,
      base_number: baseNumber,
      description: row.description || null,
      make: brand,
      model: row.model || null,
      group_code: row.category || null,
      class_code: row.section || "base",
      price_cents: cents(row.listPriceCents),
      cost_cents: cents(row.dealerCostCents),
      active_for_build: true,
      active_for_equipment: true,
      added_at: row.effectiveDate || null,
      modified_at: row.pricingUpdatedDate || row.publishedDate || row.effectiveDate || null,
      miscellaneous: buildBaseMetadata({ parsed, row }),
      deleted_at: null,
    };
    if (row.model) {
      const modelBases = baseRowsByModel.get(row.model) ?? [];
      modelBases.push({ baseNumber, row });
      baseRowsByModel.set(row.model, modelBases);
    }
    return entry;
  });

  const optionUpserts = [];
  const duplicateOptionKeys = new Set();
  const duplicateOptionRows = [];
  const orphanOptionRows = [];

  for (const row of optionRows) {
    const modelBases = row.model ? baseRowsByModel.get(row.model) : null;
    if (!modelBases?.length) {
      orphanOptionRows.push({ partNumber: row.partNumber, model: row.model ?? null, reason: "no_matching_base_for_model" });
      continue;
    }

    for (const base of modelBases) {
      const optionNumber = canonicalOptionNumber(brand, row.partNumber);
      const duplicateKey = `${base.baseNumber}\u0000${optionNumber}`;
      if (duplicateOptionKeys.has(duplicateKey)) {
        duplicateOptionRows.push({ baseNumber: base.baseNumber, optionNumber, model: row.model, reason: "duplicate_option_for_base" });
        continue;
      }
      duplicateOptionKeys.add(duplicateKey);

      optionUpserts.push({
        workspace_id: workspaceId,
        canonical_base_number: base.baseNumber,
        option_number: optionNumber,
        description: row.description || null,
        price_cents: cents(row.listPriceCents),
        master_price_cents: cents(row.listPriceCents),
        cost_cents: cents(row.dealerCostCents),
        master_cost_cents: cents(row.dealerCostCents),
        added_at: row.effectiveDate || null,
        modified_at: row.pricingUpdatedDate || row.publishedDate || row.effectiveDate || null,
        is_active: true,
        deleted_at: null,
      });
    }
  }

  const transformSkipped = [...duplicateOptionRows, ...orphanOptionRows];
  const rowsSkipped = Number(parsed.summary?.skippedRowCount ?? 0) + transformSkipped.length;

  return {
    brand,
    manufacturer: brandKey(brand),
    parentOem: parsed.parentOem ?? "YCENA",
    workspaceId,
    sourceFilename: parsed.sourceFilename ?? null,
    sourceSha256: parsed.sourceSha256 ?? null,
    sourceType: parsed.sourceType ?? "ycena_price_book_pdf_text",
    effectiveDate: parsed.effectiveDate ?? null,
    pricingUpdatedDate: parsed.pricingUpdatedDate ?? null,
    publishedDate: parsed.publishedDate ?? null,
    dealerDiscountOffListPct: parsed.dealerDiscountOffListPct ?? 30,
    parserSummary: parsed.summary ?? {},
    baseUpserts,
    optionUpserts,
    skipped: {
      parser: parsed.skipped ?? [],
      transform: transformSkipped,
    },
    summary: {
      parsedRows: parsedRows.length,
      parsedBaseRows: baseRows.length,
      parsedOptionRows: optionRows.length,
      baseUpserts: baseUpserts.length,
      optionAssociations: optionUpserts.length,
      rowsSkipped,
      modelCount: parsed.summary?.modelCount ?? 0,
      models: parsed.summary?.models ?? [],
    },
  };
}

function summarizePlan(plan, applied = null) {
  return compactObject({
    brand: plan.brand,
    manufacturer: plan.manufacturer,
    parentOem: plan.parentOem,
    workspaceId: plan.workspaceId,
    sourceFilename: plan.sourceFilename,
    sourceSha256: plan.sourceSha256,
    sourceType: plan.sourceType,
    effectiveDate: plan.effectiveDate,
    pricingUpdatedDate: plan.pricingUpdatedDate,
    publishedDate: plan.publishedDate,
    dealerDiscountOffListPct: plan.dealerDiscountOffListPct,
    parserSummary: plan.parserSummary,
    importSummary: plan.summary,
    skippedPreview: {
      parser: plan.skipped.parser.slice(0, 10),
      transform: plan.skipped.transform.slice(0, 10),
    },
    applied,
  });
}

async function selectExistingBaseNumbers(client, workspaceId, baseNumbers) {
  const existing = new Set();
  for (const values of chunk([...new Set(baseNumbers)])) {
    const { data, error } = await client
      .from("equipment_base_codes")
      .select("base_number")
      .eq("workspace_id", workspaceId)
      .in("base_number", values);
    if (error) throw error;
    for (const row of data ?? []) existing.add(row.base_number);
  }
  return existing;
}

async function upsertBaseRows(client, plan) {
  const baseNumbers = plan.baseUpserts.map((row) => row.base_number);
  const existing = await selectExistingBaseNumbers(client, plan.workspaceId, baseNumbers);

  const baseIdByNumber = new Map();
  for (const rows of chunk(plan.baseUpserts)) {
    const { data, error } = await client
      .from("equipment_base_codes")
      .upsert(rows, { onConflict: "workspace_id,base_number" })
      .select("id, base_number");
    if (error) throw error;
    for (const row of data ?? []) baseIdByNumber.set(row.base_number, row.id);
  }

  return {
    baseIdByNumber,
    inserted: baseNumbers.filter((value) => !existing.has(value)).length,
    updated: baseNumbers.filter((value) => existing.has(value)).length,
  };
}

async function selectExistingOptionKeys(client, workspaceId, optionRows) {
  const existing = new Set();
  const baseIds = [...new Set(optionRows.map((row) => row.base_code_id))];
  const optionNumbers = [...new Set(optionRows.map((row) => row.option_number))];

  for (const baseIdChunk of chunk(baseIds, 75)) {
    for (const optionChunk of chunk(optionNumbers, 75)) {
      const { data, error } = await client
        .from("equipment_options")
        .select("base_code_id, option_number")
        .eq("workspace_id", workspaceId)
        .in("base_code_id", baseIdChunk)
        .in("option_number", optionChunk);
      if (error) throw error;
      for (const row of data ?? []) existing.add(`${row.base_code_id}\u0000${row.option_number}`);
    }
  }

  return existing;
}

async function upsertOptionRows(client, plan, baseIdByNumber) {
  const optionRows = plan.optionUpserts.map((row) => {
    const baseCodeId = baseIdByNumber.get(row.canonical_base_number);
    if (!baseCodeId) throw new Error(`Missing base_code_id for ${row.canonical_base_number}`);
    const { canonical_base_number: _canonicalBaseNumber, ...rest } = row;
    return {
      ...rest,
      base_code_id: baseCodeId,
      description: row.description,
    };
  });

  const existing = await selectExistingOptionKeys(client, plan.workspaceId, optionRows);
  for (const rows of chunk(optionRows)) {
    const { error } = await client
      .from("equipment_options")
      .upsert(rows, { onConflict: "workspace_id,base_code_id,option_number" });
    if (error) throw error;
  }

  return {
    inserted: optionRows.filter((row) => !existing.has(`${row.base_code_id}\u0000${row.option_number}`)).length,
    updated: optionRows.filter((row) => existing.has(`${row.base_code_id}\u0000${row.option_number}`)).length,
  };
}

async function recordImportRun(client, plan, appliedCounts) {
  const metadata = {
    source: "ycena_sample_import",
    parent_oem: plan.parentOem,
    brand: plan.brand,
    source_type: plan.sourceType,
    parser_summary: plan.parserSummary,
    import_summary: plan.summary,
    applied_counts: appliedCounts,
    skipped_preview: plan.skipped,
    canonical_base_number_policy: "brand-prefixed to avoid ASV/Yanmar overlap under legacy unique(workspace_id, base_number)",
    option_policy: "model-level options are associated to each imported base row for the same brand/model",
  };

  const { data, error } = await client
    .from("equipment_base_codes_import_runs")
    .insert({
      workspace_id: plan.workspaceId,
      manufacturer: plan.manufacturer,
      import_format: "ycena_pdf_price_book",
      source_filename: plan.sourceFilename,
      source_storage_path: null,
      source_sha256: plan.sourceSha256,
      rows_inserted: appliedCounts.baseInserted + appliedCounts.optionInserted,
      rows_updated: appliedCounts.baseUpdated + appliedCounts.optionUpdated,
      rows_skipped: plan.summary.rowsSkipped,
      run_status: "completed",
      error: null,
      metadata,
    })
    .select("id, created_at, ran_at")
    .single();

  if (error) throw error;
  return data;
}

async function applyImportPlan(client, plan) {
  const baseResult = await upsertBaseRows(client, plan);
  const optionResult = await upsertOptionRows(client, plan, baseResult.baseIdByNumber);
  const appliedCounts = {
    baseInserted: baseResult.inserted,
    baseUpdated: baseResult.updated,
    optionInserted: optionResult.inserted,
    optionUpdated: optionResult.updated,
  };
  const run = await recordImportRun(client, plan, appliedCounts);
  return { ...appliedCounts, run };
}

function parseArgs(argv) {
  const args = { sources: [], workspaceId: DEFAULT_WORKSPACE_ID, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") args.sources.push(argv[++index]);
    else if (arg === "--workspace") args.workspaceId = argv[++index];
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (args.sources.length === 0) {
    throw new Error("Usage: node scripts/oem/ycena-sample-import.mjs --source ASV=/path/book.pdf --source Yanmar=/path/book.pdf [--workspace default] [--apply]");
  }

  return args;
}

function parseSourceSpec(spec) {
  const separator = spec.indexOf("=");
  if (separator <= 0) throw new Error(`Invalid --source value: ${spec}. Use Brand=/path/file.pdf`);
  const brand = normalizeBrand(spec.slice(0, separator));
  const path = spec.slice(separator + 1);
  if (!brand || !SUPPORTED_BRANDS.has(brand)) throw new Error(`Unsupported source brand: ${spec.slice(0, separator)}`);
  if (!path) throw new Error(`Missing source path for ${brand}`);
  return { brand, path };
}

function createSupabaseClient() {
  loadLocalEnv(repoRoot);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to apply YCENA sample imports.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceSpecs = args.sources.map(parseSourceSpec);
  const plans = sourceSpecs.map(({ brand, path }) => {
    const parsed = parseYcenaPriceBookFile(path, { brand, dealerDiscountOffListPct: 30 });
    return buildYcenaSampleImportPlan(parsed, { brand, workspaceId: args.workspaceId });
  });

  const client = args.apply ? createSupabaseClient() : null;
  const sources = [];
  for (const plan of plans) {
    const applied = client ? await applyImportPlan(client, plan) : null;
    sources.push(summarizePlan(plan, applied));
  }

  const aggregate = sources.reduce((acc, source) => {
    const summary = source.importSummary;
    acc.parsedRows += summary.parsedRows;
    acc.baseUpserts += summary.baseUpserts;
    acc.optionAssociations += summary.optionAssociations;
    acc.rowsSkipped += summary.rowsSkipped;
    if (source.applied) {
      acc.baseInserted += source.applied.baseInserted;
      acc.baseUpdated += source.applied.baseUpdated;
      acc.optionInserted += source.applied.optionInserted;
      acc.optionUpdated += source.applied.optionUpdated;
    }
    return acc;
  }, {
    parsedRows: 0,
    baseUpserts: 0,
    optionAssociations: 0,
    rowsSkipped: 0,
    baseInserted: 0,
    baseUpdated: 0,
    optionInserted: 0,
    optionUpdated: 0,
  });

  process.stdout.write(`${JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    workspaceId: args.workspaceId,
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    aggregate,
    sources,
  }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
