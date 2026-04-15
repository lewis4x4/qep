/**
 * CDK PARTMAST parser — maps the 187-column DMS export to parts_catalog + parts_history_monthly.
 *
 * File format: xlsx with first-row headers matching CDK PARTMAST layout.
 * Reference: CDK DDS PMREC record spec (see /Users/brianlewis/.../PARTMAST_04092026.pdf).
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  FIELD_PRIORITY,
  MANUAL_OVERRIDE_FIELDS,
  parseCdkDate,
  parseInt32,
  parseNumber,
  parseStr,
  type ImportOptions,
  type PreviewStats,
} from "./parts-import-types.ts";

/** Row from the spreadsheet (xlsx sheet_to_json output with headers as keys). */
type RawRow = Record<string, unknown>;

export interface PartmastParsed {
  part_number: string;
  description: string | null;
  cost_price: number | null;
  average_cost: number | null;
  pkg_qty: number | null;
  parts_per_package: number | null;
  stocking_code: string | null;
  on_hand: number | null;
  last_sale_date: string | null;
  dms_date_added: string | null;
  dms_last_modified: string | null;
  dms_last_ordered: string | null;
  dms_last_stock_ordered: string | null;
  last_count_date: string | null;
  co_code: string;
  div_code: string;
  branch_code: string;
  machine_code: string | null;
  model_code: string | null;
  list_price: number | null;
  source_of_supply: string | null;
  vendor_code: string | null;
  lead_time_days: number | null;
  on_order: number | null;
  back_ordered: number | null;
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
  quantity_allocated: number | null;
  quantity_reserved: number | null;
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
  /** Monthly history: sales_qty[1..24], bin_trips[1..24], demands[1..24]. */
  history: Array<{
    month_offset: number;
    sales_qty: number;
    bin_trips: number;
    demands: number;
  }>;
  raw: RawRow;
}

/** Map CDK PARTMAST headers (as they appear in Lake City xlsx) to parsed fields. */
export function parsePartmastRow(row: RawRow): PartmastParsed | { error: string } {
  const partNumber = parseStr(row["Part Number:"] ?? row["Part Number"] ?? row["part_number"]);
  if (!partNumber) return { error: "missing part_number" };

  const history: PartmastParsed["history"] = [];
  for (let i = 1; i <= 24; i++) {
    const sales = parseNumber(row[`Sales Quantity ${i} Month${i === 1 ? "" : "s"} Ago`]) ?? 0;
    const trips = parseInt32(
      row[`Bin Trips ${i} Month${i === 1 ? "" : "s"} Ago`] ??
      row[`Bin Trips ${i} Months Ag`] ??  // source file has typo on some indices
      row[`Bin Trips ${i} Months Ag${i}`]
    ) ?? 0;
    const demands = parseInt32(
      row[`Demand ${i} Month${i === 1 ? "" : "s"} Ago`] ??
      row[`Demands ${i} Month${i === 1 ? "" : "s"} Ago`]
    ) ?? 0;
    if (sales !== 0 || trips !== 0 || demands !== 0) {
      history.push({ month_offset: i, sales_qty: sales, bin_trips: trips, demands });
    }
  }

  return {
    part_number: partNumber,
    description: parseStr(row["Description:"] ?? row["Description"]),
    cost_price: parseNumber(row["Cost:"] ?? row["Cost"]),
    average_cost: parseNumber(row["Average Cost"]),
    pkg_qty: parseInt32(row["Pkg Qty"]),
    parts_per_package: parseInt32(row["Parts Per Package"]),
    stocking_code: parseStr(row["Stocking Code:"] ?? row["Stocking Code"]),
    on_hand: parseNumber(row["Inventory"]),
    last_sale_date: parseCdkDate(row["Last Sale Date"]),
    dms_date_added: parseCdkDate(row["Date Added"]),
    dms_last_modified: cdkDateToTimestamptz(row["Date Modified"]),
    dms_last_ordered: cdkDateToTimestamptz(row["Date Last Ordered"]),
    dms_last_stock_ordered: cdkDateToTimestamptz(row["Date Last Stock Ordered"]),
    last_count_date: parseCdkDate(row["Last Count Date"]),
    co_code: parseStr(row["Co"]) ?? "",
    div_code: parseStr(row["Div"]) ?? "",
    branch_code: parseStr(row["Br"]) ?? "",
    machine_code: parseStr(row["Machine"]),
    model_code: parseStr(row["Model"]),
    list_price: parseNumber(row["Price:"] ?? row["Price"]),
    source_of_supply: parseStr(row["Source of Supply:"] ?? row["Source of Supply"]),
    vendor_code: parseStr(row["Vendor #"] ?? row["Vendor"]),
    lead_time_days: parseInt32(row["Lead Time"]),
    on_order: parseNumber(row["On Order:"] ?? row["On Order"]),
    back_ordered: parseNumber(row["Back Ordered"]),
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
    quantity_allocated: parseNumber(row["Quantity Allocated"]),
    quantity_reserved: parseNumber(row["Quantity Reserved"]),
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
    history,
    raw: row,
  };
}

function cdkDateToTimestamptz(raw: unknown): string | null {
  const d = parseCdkDate(raw);
  return d ? `${d}T00:00:00Z` : null;
}

/** Header signature check — detect PARTMAST by presence of CDK-specific columns. */
export function looksLikePartmast(headers: string[]): boolean {
  const sig = ["Part Number:", "Status", "Co", "Div", "Br", "Bin Location:", "R.O.P."];
  const found = sig.filter((h) => headers.includes(h)).length;
  return found >= 5;
}

/**
 * Build preview diff by comparing parsed rows to existing parts_catalog rows.
 * Identifies conflicts where manual_override flags block auto-overwrite.
 */
export async function previewPartmast(
  supabase: SupabaseClient,
  workspaceId: string,
  parsed: PartmastParsed[],
  _opts: ImportOptions,
): Promise<{ stats: PreviewStats; plan: PartmastImportPlan }> {
  const stats: PreviewStats = {
    rows_scanned: parsed.length,
    rows_to_insert: 0,
    rows_to_update: 0,
    rows_unchanged: 0,
    rows_errored: 0,
    rows_conflicted: 0,
    sample_inserts: [],
    sample_updates: [],
    errors: [],
  };

  const plan: PartmastImportPlan = {
    inserts: [],
    updates: [],
    conflicts: [],
  };

  // Fetch existing rows for this workspace (all branches; we key on co/div/br/pn).
  const partNumbers = Array.from(new Set(parsed.map((p) => p.part_number)));
  const existingByKey = new Map<string, ExistingPart>();

  // Batch in chunks of 1000 to stay under in-clause limits
  for (let i = 0; i < partNumbers.length; i += 1000) {
    const chunk = partNumbers.slice(i, i + 1000);
    const { data, error } = await supabase
      .from("parts_catalog")
      .select(
        "id, part_number, co_code, div_code, branch_code, description, cost_price, on_hand, on_order, back_ordered, list_price, bin_location, reorder_point, eoq, safety_stock_qty, pricing_level_1, pricing_level_2, pricing_level_3, pricing_level_4, class_code, category, category_code, bin_location_manual_override, reorder_point_manual_override, eoq_manual_override, safety_stock_manual_override, list_price_manual_override, pricing_level_1_manual_override, pricing_level_2_manual_override, pricing_level_3_manual_override, pricing_level_4_manual_override, description_manual_override, category_manual_override, class_code_manual_override, manual_updated_by, manual_updated_at",
      )
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("part_number", chunk);

    if (error) throw new Error(`parts_catalog lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      const key = buildKey(row.co_code ?? "", row.div_code ?? "", row.branch_code ?? "", row.part_number);
      existingByKey.set(key, row as ExistingPart);
    }
  }

  for (const p of parsed) {
    const key = buildKey(p.co_code, p.div_code, p.branch_code, p.part_number);
    const existing = existingByKey.get(key);
    if (!existing) {
      plan.inserts.push(p);
      stats.rows_to_insert++;
      if (stats.sample_inserts.length < 10) {
        stats.sample_inserts.push({
          part_number: p.part_number,
          description: p.description,
          cost_price: p.cost_price,
          list_price: p.list_price,
          on_hand: p.on_hand,
          branch: p.branch_code,
        });
      }
      continue;
    }

    // Compute changed fields
    const changed: string[] = [];
    const conflicts: PlannedConflict[] = [];

    for (const [field, incomingValue] of partmastFieldPairs(p)) {
      // @ts-ignore dynamic field
      const currentValue = existing[field];
      if (normalizeEq(currentValue, incomingValue)) continue;

      // Manual override guard
      const overrideField = `${field}_manual_override` as keyof ExistingPart;
      const overrideFlag = (existing as Record<string, unknown>)[overrideField];
      if (MANUAL_OVERRIDE_FIELDS.includes(field as never) && overrideFlag === true) {
        conflicts.push({
          part_id: existing.id,
          part_number: p.part_number,
          field_name: field,
          current_value: currentValue,
          incoming_value: incomingValue,
          priority: FIELD_PRIORITY[field] ?? "normal",
          current_set_by: existing.manual_updated_by,
          current_set_at: existing.manual_updated_at,
        });
      } else {
        changed.push(field);
      }
    }

    if (changed.length === 0 && conflicts.length === 0) {
      stats.rows_unchanged++;
      continue;
    }

    plan.updates.push({ parsed: p, existing, changed_fields: changed });
    stats.rows_to_update++;
    if (conflicts.length > 0) {
      plan.conflicts.push(...conflicts);
      stats.rows_conflicted++;
    }

    if (stats.sample_updates.length < 10 && changed.length > 0) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const f of changed.slice(0, 6)) {
        // @ts-ignore
        before[f] = existing[f];
        // @ts-ignore
        after[f] = (p as Record<string, unknown>)[f];
      }
      stats.sample_updates.push({
        key,
        before,
        after,
        changed_fields: changed,
      });
    }
  }

  return { stats, plan };
}

export interface ExistingPart {
  id: string;
  part_number: string;
  co_code: string;
  div_code: string;
  branch_code: string;
  description: string | null;
  cost_price: number | null;
  list_price: number | null;
  on_hand: number | null;
  on_order: number | null;
  back_ordered: number | null;
  bin_location: string | null;
  reorder_point: number | null;
  eoq: number | null;
  safety_stock_qty: number | null;
  pricing_level_1: number | null;
  pricing_level_2: number | null;
  pricing_level_3: number | null;
  pricing_level_4: number | null;
  class_code: string | null;
  category: string | null;
  category_code: string | null;
  bin_location_manual_override: boolean;
  reorder_point_manual_override: boolean;
  eoq_manual_override: boolean;
  safety_stock_manual_override: boolean;
  list_price_manual_override: boolean;
  pricing_level_1_manual_override: boolean;
  pricing_level_2_manual_override: boolean;
  pricing_level_3_manual_override: boolean;
  pricing_level_4_manual_override: boolean;
  description_manual_override: boolean;
  category_manual_override: boolean;
  class_code_manual_override: boolean;
  manual_updated_by: string | null;
  manual_updated_at: string | null;
}

export interface PlannedConflict {
  part_id: string;
  part_number: string;
  field_name: string;
  current_value: unknown;
  incoming_value: unknown;
  priority: "high" | "normal" | "low";
  current_set_by: string | null;
  current_set_at: string | null;
}

export interface PartmastImportPlan {
  inserts: PartmastParsed[];
  updates: Array<{
    parsed: PartmastParsed;
    existing: ExistingPart;
    changed_fields: string[];
  }>;
  conflicts: PlannedConflict[];
}

function buildKey(co: string, div: string, br: string, pn: string): string {
  return `${co}|${div}|${br}|${pn}`;
}

function normalizeEq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.0001;
  }
  return String(a).trim() === String(b).trim();
}

/** Emit (field_name, value) pairs from a parsed row for diffing. */
function partmastFieldPairs(p: PartmastParsed): Array<[string, unknown]> {
  return [
    ["description", p.description],
    ["cost_price", p.cost_price],
    ["list_price", p.list_price],
    ["on_hand", p.on_hand],
    ["on_order", p.on_order],
    ["back_ordered", p.back_ordered],
    ["bin_location", p.bin_location],
    ["reorder_point", p.reorder_point],
    ["eoq", p.eoq],
    ["safety_stock_qty", p.safety_stock_qty],
    ["pricing_level_1", p.pricing_level_1],
    ["pricing_level_2", p.pricing_level_2],
    ["pricing_level_3", p.pricing_level_3],
    ["pricing_level_4", p.pricing_level_4],
    ["class_code", p.class_code],
    ["category_code", p.category_code],
  ];
}

/** Map a parsed row to parts_catalog upsert payload. */
export function toPartsCatalogUpsert(
  p: PartmastParsed,
  workspaceId: string,
  runId: string,
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    part_number: p.part_number,
    description: p.description,
    cost_price: p.cost_price,
    average_cost: p.average_cost,
    list_price: p.list_price,
    pkg_qty: p.pkg_qty,
    parts_per_package: p.parts_per_package,
    stocking_code: p.stocking_code,
    on_hand: p.on_hand,
    on_order: p.on_order,
    back_ordered: p.back_ordered,
    last_sale_date: p.last_sale_date,
    dms_date_added: p.dms_date_added,
    dms_last_modified: p.dms_last_modified,
    dms_last_ordered: p.dms_last_ordered,
    dms_last_stock_ordered: p.dms_last_stock_ordered,
    last_count_date: p.last_count_date,
    co_code: p.co_code,
    div_code: p.div_code,
    branch_code: p.branch_code,
    machine_code: p.machine_code,
    model_code: p.model_code,
    source_of_supply: p.source_of_supply,
    vendor_code: p.vendor_code,
    lead_time_days: p.lead_time_days,
    safety_stock_qty: p.safety_stock_qty,
    eoq: p.eoq,
    reorder_point: p.reorder_point,
    bin_location: p.bin_location,
    previous_bin_location: p.previous_bin_location,
    ytd_sales_dollars: p.ytd_sales_dollars,
    last_year_sales_dollars: p.last_year_sales_dollars,
    last_year_sales_qty: p.last_year_sales_qty,
    last_12mo_sales: p.last_12mo_sales,
    region_last_12mo_sales: p.region_last_12mo_sales,
    quantity_allocated: p.quantity_allocated,
    quantity_reserved: p.quantity_reserved,
    class_code: p.class_code,
    category_code: p.category_code,
    movement_code: p.movement_code,
    activity_code: p.activity_code,
    asl_category: p.asl_category,
    weight_lbs: p.weight_lbs,
    avatax_product_code: p.avatax_product_code,
    avatax_use_exemption: p.avatax_use_exemption,
    pricing_level_1: p.pricing_level_1,
    pricing_level_2: p.pricing_level_2,
    pricing_level_3: p.pricing_level_3,
    pricing_level_4: p.pricing_level_4,
    last_po_number: p.last_po_number,
    average_inventory: p.average_inventory,
    dms_status: p.dms_status,
    last_import_run_id: runId,
    raw_dms_row: p.raw,
  };
}
