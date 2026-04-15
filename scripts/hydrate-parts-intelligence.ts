#!/usr/bin/env bun
/**
 * Hydrate Parts Intelligence Engine from delivered files.
 *
 * Loads:
 *   1. Parts List.xlsx              → parts_catalog + parts_history_monthly
 *   2. 2026-Yanmar-Parts-Price-File → parts_vendor_prices (attached to Yanmar)
 *   3. Company Vendor Contacts 2026 → vendor_profiles + vendor_contacts + vendor_order_schedules
 *
 * Runs via service_role against the database directly (no edge function deploy needed).
 * Creates a parts_import_runs row per file for audit continuity.
 *
 * Usage:
 *   bun run scripts/hydrate-parts-intelligence.ts \
 *     --dir=/Users/brianlewis/Downloads/fwmixingequipmentwsecurity \
 *     --workspace=default \
 *     [--dry-run] [--skip=partmast,vendor_price,vendor_contacts]
 *
 * Env (from .env.local or shell):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLocalEnv } from "./_shared/local-env.mjs";

loadLocalEnv(join(import.meta.dir, ".."));

// ── args ────────────────────────────────────────────────────

function parseArgs() {
  const dirArg = process.argv.find((a) => a.startsWith("--dir="));
  const wsArg = process.argv.find((a) => a.startsWith("--workspace="));
  const skipArg = process.argv.find((a) => a.startsWith("--skip="));
  const dryRun = process.argv.includes("--dry-run");
  return {
    dir: dirArg?.split("=")[1] ?? "/Users/brianlewis/Downloads/fwmixingequipmentwsecurity",
    workspaceId: wsArg?.split("=")[1] ?? "default",
    skip: new Set(skipArg?.split("=")[1]?.split(",") ?? []),
    dryRun,
  };
}

// ── helpers ─────────────────────────────────────────────────

function parseStr(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

function parseNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseInt32(raw: unknown): number | null {
  const n = parseNumber(raw);
  return n == null ? null : Math.trunc(n);
}

function parseCdkDate(raw: unknown): string | null {
  if (raw == null || raw === "" || raw === 0 || raw === "0") return null;
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
    if (y === "0000" || m === "00" || d === "00") return null;
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(s);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

async function sha256(buf: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function logStep(icon: string, msg: string) {
  console.log(`${icon}  ${msg}`);
}

// ── run row management ──────────────────────────────────────

async function createRun(
  sb: SupabaseClient,
  workspaceId: string,
  fileName: string,
  buf: Buffer,
  fileType: "partmast" | "vendor_price" | "vendor_contacts",
  vendorId: string | null = null,
): Promise<string> {
  const hash = await sha256(buf);
  const { data, error } = await sb
    .from("parts_import_runs")
    .insert({
      workspace_id: workspaceId,
      source_file_name: fileName,
      source_file_hash: hash,
      file_type: fileType,
      vendor_id: vendorId,
      status: "committing",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`run create failed: ${error?.message}`);
  return data.id;
}

async function finishRun(
  sb: SupabaseClient,
  runId: string,
  stats: { inserted: number; updated: number; rows_scanned: number },
): Promise<void> {
  await sb
    .from("parts_import_runs")
    .update({
      status: "committed",
      row_count: stats.rows_scanned,
      rows_inserted: stats.inserted,
      rows_updated: stats.updated,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

// ── PARTMAST hydration ─────────────────────────────────────

interface PartmastRow {
  workspace_id: string;
  part_number: string;
  description: string | null;
  cost_price: number | null;
  average_cost: number | null;
  list_price: number | null;
  pkg_qty: number | null;
  parts_per_package: number | null;
  stocking_code: string | null;
  on_hand: number | null;
  on_order: number | null;
  back_ordered: number | null;
  last_sale_date: string | null;
  dms_date_added: string | null;
  dms_last_modified: string | null;
  dms_last_ordered: string | null;
  last_count_date: string | null;
  co_code: string;
  div_code: string;
  branch_code: string;
  machine_code: string | null;
  model_code: string | null;
  source_of_supply: string | null;
  vendor_code: string | null;
  lead_time_days: number | null;
  safety_stock_qty: number | null;
  eoq: number | null;
  reorder_point: number | null;
  bin_location: string | null;
  previous_bin_location: string | null;
  ytd_sales_dollars: number | null;
  last_year_sales_dollars: number | null;
  last_year_sales_qty: number | null;
  last_12mo_sales: number | null;
  region_last_12mo_sales: number | null;
  class_code: string | null;
  category_code: string | null;
  movement_code: string | null;
  activity_code: string | null;
  asl_category: string | null;
  weight_lbs: number | null;
  avatax_product_code: string | null;
  avatax_use_exemption: string | null;
  pricing_level_1: number | null;
  pricing_level_2: number | null;
  pricing_level_3: number | null;
  pricing_level_4: number | null;
  last_po_number: string | null;
  average_inventory: number | null;
  dms_status: string | null;
  quantity_allocated: number | null;
  quantity_reserved: number | null;
  last_import_run_id: string;
  raw_dms_row: Record<string, unknown>;
}

interface HistoryRow {
  month_offset: number;
  sales_qty: number;
  bin_trips: number;
  demands: number;
}

function rowToPartmast(
  row: Record<string, unknown>,
  workspaceId: string,
  runId: string,
): { part: PartmastRow; history: HistoryRow[] } | null {
  const partNumber = parseStr(row["Part Number:"] ?? row["Part Number"]);
  if (!partNumber) return null;

  const history: HistoryRow[] = [];
  for (let i = 1; i <= 24; i++) {
    const sales = parseNumber(row[`Sales Quantity ${i} Month${i === 1 ? "" : "s"} Ago`]) ?? 0;
    const tripsKey = [
      `Bin Trips ${i} Month${i === 1 ? "" : "s"} Ago`,
      `Bin Trips ${i} Months Ag`,
    ].find((k) => row[k] != null);
    const trips = parseInt32(tripsKey ? row[tripsKey] : null) ?? 0;
    const demandsKey =
      row[`Demand ${i} Month${i === 1 ? "" : "s"} Ago`] != null
        ? `Demand ${i} Month${i === 1 ? "" : "s"} Ago`
        : `Demands ${i} Month${i === 1 ? "" : "s"} Ago`;
    const demands = parseInt32(row[demandsKey]) ?? 0;
    if (sales !== 0 || trips !== 0 || demands !== 0) {
      history.push({ month_offset: i, sales_qty: sales, bin_trips: trips, demands });
    }
  }

  return {
    history,
    part: {
      workspace_id: workspaceId,
      part_number: partNumber,
      description: parseStr(row["Description:"] ?? row["Description"]),
      cost_price: parseNumber(row["Cost:"] ?? row["Cost"]),
      average_cost: parseNumber(row["Average Cost"]),
      list_price: parseNumber(row["Price:"] ?? row["Price"]),
      pkg_qty: parseInt32(row["Pkg Qty"]),
      parts_per_package: parseInt32(row["Parts Per Package"]),
      stocking_code: parseStr(row["Stocking Code:"] ?? row["Stocking Code"]),
      on_hand: parseNumber(row["Inventory"]),
      on_order: parseNumber(row["On Order:"] ?? row["On Order"]),
      back_ordered: parseNumber(row["Back Ordered"]),
      last_sale_date: parseCdkDate(row["Last Sale Date"]),
      dms_date_added: parseCdkDate(row["Date Added"]),
      dms_last_modified: parseCdkDate(row["Date Modified"]) ? `${parseCdkDate(row["Date Modified"])}T00:00:00Z` : null,
      dms_last_ordered: parseCdkDate(row["Date Last Ordered"]) ? `${parseCdkDate(row["Date Last Ordered"])}T00:00:00Z` : null,
      last_count_date: parseCdkDate(row["Last Count Date"]),
      co_code: parseStr(row["Co"]) ?? "",
      div_code: parseStr(row["Div"]) ?? "",
      branch_code: parseStr(row["Br"]) ?? "",
      machine_code: parseStr(row["Machine"]),
      model_code: parseStr(row["Model"]),
      source_of_supply: parseStr(row["Source of Supply:"] ?? row["Source of Supply"]),
      vendor_code: parseStr(row["Vendor #"]),
      lead_time_days: parseInt32(row["Lead Time"]),
      safety_stock_qty: parseNumber(row["S.S.(F %)"]),
      eoq: parseNumber(row["Ord Qty"]),
      reorder_point: parseNumber(row["R.O.P."]),
      bin_location: parseStr(row["Bin Location:"] ?? row["Bin Location"]),
      previous_bin_location: parseStr(row["Previous Bin Location"]),
      ytd_sales_dollars: parseNumber(row["YTD Sales Dollars"]),
      last_year_sales_dollars: parseNumber(row["Last Year Sales Dollars"]),
      last_year_sales_qty: parseNumber(row["Last Year Sales Quantity"]),
      last_12mo_sales: parseNumber(row["Last 12 Months Sales"]),
      region_last_12mo_sales: parseNumber(row["Region Last 12 Months Sales"]),
      class_code: parseStr(row["Class:"] ?? row["Class"]),
      category_code: parseStr(row["Category"]),
      movement_code: parseStr(row["Movement Code:"] ?? row["Movement Code"]),
      activity_code: parseStr(row["Activity Code:"] ?? row["Activity Code"]),
      asl_category: parseStr(row["ASL Category"]),
      weight_lbs: parseNumber(row["Weight"]),
      avatax_product_code: parseStr(row["AvaTax Product Code"]),
      avatax_use_exemption: parseStr(row["Avatax Use Exemption"]),
      pricing_level_1: parseNumber(row["Pricing Level 1"]),
      pricing_level_2: parseNumber(row["Pricing Level 2"]),
      pricing_level_3: parseNumber(row["Pricing Level 3"]),
      pricing_level_4: parseNumber(row["Pricing Level 4"]),
      last_po_number: parseStr(row["Last PO#"]),
      average_inventory: parseNumber(row["Average Inventory"]),
      dms_status: parseStr(row["Status"])?.slice(0, 1) ?? null,
      quantity_allocated: parseNumber(row["Quantity Allocated"]),
      quantity_reserved: parseNumber(row["Quantity Reserved"]),
      last_import_run_id: runId,
      raw_dms_row: row,
    },
  };
}

async function hydratePartmast(
  sb: SupabaseClient,
  workspaceId: string,
  filePath: string,
  dryRun: boolean,
): Promise<{ inserted: number; updated: number; history: number; scanned: number }> {
  logStep("📦", `Reading ${filePath}`);
  const buf = readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  logStep("📊", `${rows.length.toLocaleString()} rows found in PARTMAST`);

  if (dryRun) {
    logStep("🔍", `Dry run — sample parsed row:`);
    const sample = rowToPartmast(rows[0], workspaceId, "DRY_RUN");
    console.log(JSON.stringify({ part: { ...sample?.part, raw_dms_row: "<elided>" }, history_months: sample?.history.length }, null, 2));
    return { inserted: 0, updated: 0, history: 0, scanned: rows.length };
  }

  const runId = await createRun(sb, workspaceId, "Parts List.xlsx", buf, "partmast");
  logStep("📝", `Created import run ${runId.slice(0, 8)}…`);

  const parts: PartmastRow[] = [];
  const historiesByIdx: HistoryRow[][] = [];
  let skipped = 0;
  for (const row of rows) {
    const parsed = rowToPartmast(row, workspaceId, runId);
    if (!parsed) { skipped++; continue; }
    parts.push(parsed.part);
    historiesByIdx.push(parsed.history);
  }
  if (skipped > 0) logStep("⚠️ ", `${skipped} rows skipped (missing part_number)`);

  // Fetch existing parts to split inserts vs updates
  const uniquePns = Array.from(new Set(parts.map((p) => p.part_number)));
  const existingKeys = new Set<string>();
  const existingIds = new Map<string, string>();
  logStep("🔎", `Checking existing catalog for ${uniquePns.length.toLocaleString()} unique part numbers…`);
  for (let i = 0; i < uniquePns.length; i += 1000) {
    const chunk = uniquePns.slice(i, i + 1000);
    const { data, error } = await sb
      .from("parts_catalog")
      .select("id, co_code, div_code, branch_code, part_number")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("part_number", chunk);
    if (error) throw new Error(`lookup failed: ${error.message}`);
    for (const r of data ?? []) {
      const key = `${r.co_code ?? ""}|${r.div_code ?? ""}|${r.branch_code ?? ""}|${r.part_number}`;
      existingKeys.add(key);
      existingIds.set(key, r.id);
    }
  }

  const toInsert: PartmastRow[] = [];
  const toUpdate: PartmastRow[] = [];
  for (const p of parts) {
    const key = `${p.co_code}|${p.div_code}|${p.branch_code}|${p.part_number}`;
    if (existingKeys.has(key)) toUpdate.push(p);
    else toInsert.push(p);
  }

  logStep("✨", `${toInsert.length.toLocaleString()} new · ${toUpdate.length.toLocaleString()} existing`);

  // Suppress manual-override tracking trigger for bulk load
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 250) {
      const chunk = toInsert.slice(i, i + 250);
      const { error } = await sb.from("parts_catalog").insert(chunk);
      if (error) throw new Error(`insert batch at ${i} failed: ${error.message}`);
      process.stdout.write(`\r  📥 inserting… ${Math.min(i + 250, toInsert.length)}/${toInsert.length}`);
    }
    process.stdout.write("\n");
  }

  // For updates, use the SQL helper that suppresses override tracking
  if (toUpdate.length > 0) {
    for (let i = 0; i < toUpdate.length; i += 100) {
      const chunk = toUpdate.slice(i, i + 100);
      for (const p of chunk) {
        const key = `${p.co_code}|${p.div_code}|${p.branch_code}|${p.part_number}`;
        const id = existingIds.get(key);
        if (!id) continue;
        const payload = { ...p, raw_dms_row: JSON.stringify(p.raw_dms_row) };
        // Direct update with the service-role client bypasses RLS; override trigger still fires,
        // so set the session GUC first via a raw query
        const { error } = await sb.rpc("exec_suppress_override_update", {
          p_part_id: id,
          p_payload: payload as unknown as Record<string, unknown>,
        });
        if (error) {
          // Fall back to plain update if the RPC fails for any reason
          const { error: upErr } = await sb.from("parts_catalog").update(p).eq("id", id);
          if (upErr) console.warn(`  ⚠️  update failed for ${p.part_number}: ${upErr.message}`);
        }
      }
      process.stdout.write(`\r  ✏️  updating… ${Math.min(i + 100, toUpdate.length)}/${toUpdate.length}`);
    }
    process.stdout.write("\n");
  }

  // Resolve part IDs again (including new inserts) and write history
  logStep("📈", "Writing 24-month history…");
  const idByKey = new Map<string, string>();
  for (let i = 0; i < uniquePns.length; i += 1000) {
    const chunk = uniquePns.slice(i, i + 1000);
    const { data } = await sb
      .from("parts_catalog")
      .select("id, co_code, div_code, branch_code, part_number")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("part_number", chunk);
    for (const r of data ?? []) {
      idByKey.set(`${r.co_code ?? ""}|${r.div_code ?? ""}|${r.branch_code ?? ""}|${r.part_number}`, r.id);
    }
  }

  const historyRows: Array<{ workspace_id: string; part_id: string; month_offset: number; sales_qty: number; bin_trips: number; demands: number; source_import_run_id: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const key = `${p.co_code}|${p.div_code}|${p.branch_code}|${p.part_number}`;
    const id = idByKey.get(key);
    if (!id) continue;
    for (const h of historiesByIdx[i]) {
      historyRows.push({
        workspace_id: workspaceId,
        part_id: id,
        month_offset: h.month_offset,
        sales_qty: h.sales_qty,
        bin_trips: h.bin_trips,
        demands: h.demands,
        source_import_run_id: runId,
      });
    }
  }

  if (historyRows.length > 0) {
    for (let i = 0; i < historyRows.length; i += 500) {
      const chunk = historyRows.slice(i, i + 500);
      const { error } = await sb.from("parts_history_monthly").upsert(chunk, { onConflict: "part_id,month_offset" });
      if (error) throw new Error(`history upsert at ${i} failed: ${error.message}`);
      process.stdout.write(`\r  📊 history… ${Math.min(i + 500, historyRows.length)}/${historyRows.length}`);
    }
    process.stdout.write("\n");
  }

  await finishRun(sb, runId, {
    inserted: toInsert.length,
    updated: toUpdate.length,
    rows_scanned: rows.length,
  });

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    history: historyRows.length,
    scanned: rows.length,
  };
}

// ── Vendor price hydration ─────────────────────────────────

async function hydrateVendorPrice(
  sb: SupabaseClient,
  workspaceId: string,
  filePath: string,
  vendorName: string,
  dryRun: boolean,
): Promise<{ inserted: number; scanned: number; vendor_id: string }> {
  logStep("💲", `Reading ${filePath}`);
  const buf = readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  logStep("📊", `${rows.length.toLocaleString()} vendor price rows`);

  const { data: vendor, error: vErr } = await sb
    .from("vendor_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", vendorName)
    .maybeSingle();
  if (vErr) throw new Error(`vendor lookup failed: ${vErr.message}`);
  let vendorId = vendor?.id ?? null;
  if (!vendorId) {
    logStep("🆕", `Creating vendor profile for ${vendorName}`);
    if (!dryRun) {
      const { data: ins, error: iErr } = await sb
        .from("vendor_profiles")
        .insert({ workspace_id: workspaceId, name: vendorName, supplier_type: "oem" })
        .select("id")
        .single();
      if (iErr) throw new Error(`vendor insert failed: ${iErr.message}`);
      vendorId = ins.id;
    } else {
      vendorId = "DRY_RUN_VENDOR";
    }
  }

  if (dryRun) {
    logStep("🔍", "Dry run — sample row:");
    console.log(rows[0]);
    return { inserted: 0, scanned: rows.length, vendor_id: vendorId! };
  }

  const runId = await createRun(sb, workspaceId, filePath.split("/").pop()!, buf, "vendor_price", vendorId);

  const headers = Object.keys(rows[0] ?? {});
  const pnCol = headers.find((h) => /partnum/i.test(h.trim())) ?? headers.find((h) => /part/i.test(h));
  const priceCol = headers.find((h) => /list\s*price/i.test(h) && /\d{4}|jan|feb|mar|apr|may/i.test(h))
    ?? headers.find((h) => /list\s*price/i.test(h))
    ?? headers.find((h) => /price/i.test(h));
  if (!pnCol || !priceCol) throw new Error(`missing part_number/price columns: ${headers.join(", ")}`);

  const today = new Date().toISOString().slice(0, 10);
  const payload: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const pn = parseStr(row[pnCol]);
    if (!pn) continue;
    payload.push({
      workspace_id: workspaceId,
      vendor_id: vendorId,
      part_number: pn,
      description: parseStr(row["Description"]),
      description_fr: parseStr(row["French canadian description"]),
      list_price: parseNumber(row[priceCol]),
      product_code: parseStr(row["Product code"] ?? row["Product Code"]),
      effective_date: today,
      source_file: filePath.split("/").pop(),
      source_import_run_id: runId,
    });
  }

  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await sb
      .from("parts_vendor_prices")
      .upsert(chunk, { onConflict: "vendor_id,part_number,effective_date" });
    if (error) throw new Error(`vendor price upsert at ${i} failed: ${error.message}`);
    process.stdout.write(`\r  💲 prices… ${Math.min(i + 500, payload.length)}/${payload.length}`);
  }
  process.stdout.write("\n");

  await finishRun(sb, runId, { inserted: payload.length, updated: 0, rows_scanned: rows.length });

  return { inserted: payload.length, scanned: rows.length, vendor_id: vendorId };
}

// ── Vendor contacts hydration ──────────────────────────────

async function hydrateVendorContacts(
  sb: SupabaseClient,
  workspaceId: string,
  filePath: string,
  dryRun: boolean,
): Promise<{ profiles: number; contacts: number; schedules: number }> {
  logStep("👥", `Reading ${filePath}`);
  const buf = readFileSync(filePath);
  const workbook = XLSX.read(buf, { type: "buffer" });

  const groups: Array<{ company: string; contacts: Array<Record<string, unknown>>; domain: string }> = [];
  const schedules: Array<Record<string, unknown>> = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const low = name.toLowerCase();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: 1, defval: "", raw: false,
    }) as unknown as unknown[][];

    if (low.includes("ordering schedule")) {
      let currentBranch: string | null = null;
      for (const row of rows) {
        const c0 = parseStr((row ?? [])[0]);
        const c1 = parseStr((row ?? [])[1]);
        const c2 = parseStr((row ?? [])[2]);
        const c3 = parseStr((row ?? [])[3]);
        if (c0 && /parts\s+ordering/i.test(c0) && !c1) {
          currentBranch = c0.replace(/parts\s+ordering/i, "").trim();
          continue;
        }
        if (c0 && /^main\s+lines/i.test(c0)) continue;
        if (c0 && /^vendor\s*#/i.test(c0)) continue;
        if (!c0 && !c1) continue;
        schedules.push({
          vendor_code: c0,
          vendor_name: c1,
          branch: currentBranch,
          frequency: c2?.toLowerCase().includes("week") ? "weekly"
            : c2?.toLowerCase().includes("month") ? "monthly"
            : c2?.toLowerCase().includes("daily") ? "daily"
            : "on_demand",
          day_of_week: c3?.toLowerCase().slice(0, 100) ?? null,
        });
      }
    } else if (low.includes("contacts")) {
      const domain = low.includes("parts") ? "parts" : low.includes("service") ? "service" : "admin";
      let currentGroup: { company: string; contacts: Array<Record<string, unknown>>; domain: string } | null = null;
      let tier = 1;
      for (const row of rows) {
        const company = parseStr((row ?? [])[0]);
        const contactName = parseStr((row ?? [])[1]);
        const phone = parseStr((row ?? [])[2]);
        const ext = parseStr((row ?? [])[3]);
        const cell = parseStr((row ?? [])[4]);
        const email = parseStr((row ?? [])[5]);
        const title = parseStr((row ?? [])[6]);
        const notes = parseStr((row ?? [])[7]);

        if (company && /important contacts/i.test(company)) continue;
        if (company && /^company$/i.test(company)) continue;

        if (company) {
          currentGroup = { company, contacts: [], domain };
          groups.push(currentGroup);
          tier = 1;
          if (contactName && !/ESCALATION|TECHNICAL|FIRST/i.test(contactName)) {
            currentGroup.contacts.push({ contact_name: contactName, phone, ext, cell, email, title, notes, tier });
          }
          continue;
        }
        if (!company && currentGroup && contactName) {
          if (!phone && !cell && !email) {
            if (/FIRST|PRIMARY/i.test(contactName)) tier = 1;
            else if (/ESCALATION|SECOND/i.test(contactName)) tier = 2;
            else if (/TECHNICAL|THIRD/i.test(contactName)) tier = 3;
            continue;
          }
          currentGroup.contacts.push({ contact_name: contactName, phone, ext, cell, email, title, notes, tier });
        }
      }
    }
  }

  const totalContacts = groups.reduce((sum, g) => sum + g.contacts.length, 0);
  logStep("📊", `${groups.length} vendors · ${totalContacts} contacts · ${schedules.length} schedules`);

  if (dryRun) {
    logStep("🔍", "Dry run — sample group:");
    console.log(JSON.stringify(groups[0], null, 2));
    return { profiles: 0, contacts: 0, schedules: 0 };
  }

  const runId = await createRun(sb, workspaceId, filePath.split("/").pop()!, buf, "vendor_contacts");

  let profilesInserted = 0;
  let contactsInserted = 0;

  for (const g of groups) {
    const { data: existing } = await sb
      .from("vendor_profiles")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", g.company)
      .maybeSingle();

    let vendorId = existing?.id ?? null;
    if (!vendorId) {
      const { data: ins, error } = await sb
        .from("vendor_profiles")
        .insert({
          workspace_id: workspaceId,
          name: g.company,
          supplier_type: g.domain === "parts" ? "oem" : "general",
        })
        .select("id")
        .single();
      if (error) { console.warn(`  ⚠️  vendor ${g.company}: ${error.message}`); continue; }
      vendorId = ins.id;
      profilesInserted++;
    }

    for (const c of g.contacts) {
      const { data: existingContact } = await sb
        .from("vendor_contacts")
        .select("id")
        .eq("vendor_id", vendorId!)
        .eq("contact_name", c.contact_name as string)
        .maybeSingle();
      if (existingContact?.id) continue;

      const { error } = await sb.from("vendor_contacts").insert({
        workspace_id: workspaceId,
        vendor_id: vendorId,
        contact_name: c.contact_name,
        role: c.title,
        phone: [c.phone, c.ext].filter(Boolean).join(" x"),
        email: c.email,
        escalation_tier: c.tier ?? 1,
        notes: c.notes,
        is_primary: c.tier === 1,
      });
      if (error) { console.warn(`  ⚠️  contact ${c.contact_name}: ${error.message}`); continue; }
      contactsInserted++;
    }
  }

  let schedulesInserted = 0;
  for (const s of schedules) {
    let vendorId: string | null = null;
    if (s.vendor_name) {
      const { data } = await sb
        .from("vendor_profiles")
        .select("id")
        .eq("workspace_id", workspaceId)
        .ilike("name", s.vendor_name as string)
        .maybeSingle();
      vendorId = data?.id ?? null;
    }
    if (!vendorId) continue;
    const { error } = await sb
      .from("vendor_order_schedules")
      .upsert(
        {
          workspace_id: workspaceId,
          vendor_id: vendorId,
          vendor_code: s.vendor_code,
          branch_code: s.branch ?? "",
          frequency: s.frequency,
          day_of_week: s.day_of_week,
        },
        { onConflict: "vendor_id,branch_code,frequency,day_of_week" },
      );
    if (!error) schedulesInserted++;
  }

  await finishRun(sb, runId, {
    inserted: profilesInserted + contactsInserted + schedulesInserted,
    updated: 0,
    rows_scanned: groups.length + schedules.length,
  });

  return { profiles: profilesInserted, contacts: contactsInserted, schedules: schedulesInserted };
}

// ── main ────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("✖ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env (.env.local).");
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\n🔧 Parts Intelligence Hydration`);
  console.log(`   workspace: ${args.workspaceId}`);
  console.log(`   source dir: ${args.dir}`);
  console.log(`   dry run: ${args.dryRun}`);
  console.log(`   skip: ${[...args.skip].join(", ") || "(none)"}\n`);

  const partsListPath = join(args.dir, "Parts List.xlsx");
  const yanmarPath = join(args.dir, "2026-Yanmar-Parts-Price-File.xlsx");
  const contactsPath = join(args.dir, "Company Vendor Contacts 2026.xlsx");

  const summary: Record<string, unknown> = {};

  if (!args.skip.has("vendor_contacts")) {
    console.log("━━━ 1. Vendor Contacts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
      summary.vendor_contacts = await hydrateVendorContacts(sb, args.workspaceId, contactsPath, args.dryRun);
    } catch (err) {
      console.error(`  ✖ vendor_contacts failed: ${(err as Error).message}`);
      summary.vendor_contacts = { error: (err as Error).message };
    }
    console.log();
  }

  if (!args.skip.has("vendor_price")) {
    console.log("━━━ 2. Yanmar Vendor Price File ━━━━━━━━━━━━━━━━━━");
    try {
      summary.vendor_price = await hydrateVendorPrice(sb, args.workspaceId, yanmarPath, "Yanmar", args.dryRun);
    } catch (err) {
      console.error(`  ✖ vendor_price failed: ${(err as Error).message}`);
      summary.vendor_price = { error: (err as Error).message };
    }
    console.log();
  }

  if (!args.skip.has("partmast")) {
    console.log("━━━ 3. PARTMAST (Lake City) ━━━━━━━━━━━━━━━━━━━━━━━");
    try {
      summary.partmast = await hydratePartmast(sb, args.workspaceId, partsListPath, args.dryRun);
    } catch (err) {
      console.error(`  ✖ partmast failed: ${(err as Error).message}`);
      summary.partmast = { error: (err as Error).message };
    }
    console.log();
  }

  console.log("━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(JSON.stringify(summary, null, 2));
  console.log();
}

main().catch((err) => {
  console.error("✖ hydration failed:", err);
  process.exit(1);
});
