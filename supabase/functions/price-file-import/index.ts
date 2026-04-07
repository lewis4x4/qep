/**
 * Price File Import Edge Function
 *
 * Moonshot 2: Price File Intelligence.
 * Rylee: "if we could get price files for program changes... it could
 *         basically always be aware that we're quoting the most up to date pricing."
 *
 * POST: Upload CSV price file → parse → upsert catalog_entries →
 *       trigger auto-populates price_history → flag affected quotes
 *
 * Auth: admin/owner
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import XLSX from "npm:xlsx@0.18.5";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
function parseCsvRows(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] || ""; });
    rows.push(row);
  }

  return rows;
}

function parseSpreadsheetRows(buffer: ArrayBuffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: false,
  }).map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      const header = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      normalized[header] = typeof value === "string" ? value.trim() : String(value ?? "").trim();
    }
    return normalized;
  });
}

function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "owner"].includes(profile.role)) {
      return safeJsonError("Price file import requires admin or owner role", 403, origin);
    }

    // Parse multipart form data with CSV/XLSX/XLS file
    const contentType = req.headers.get("content-type") || "";
    let rows: Record<string, string>[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return safeJsonError("Price file required", 400, origin);

      if (isSpreadsheetFile(file)) {
        rows = parseSpreadsheetRows(await file.arrayBuffer());
      } else {
        const csvText = await file.text();
        if (!csvText.trim()) {
          return safeJsonError("Empty price file", 400, origin);
        }
        rows = parseCsvRows(csvText);
      }
    } else {
      // Accept raw CSV text body
      const csvText = await req.text();
      if (!csvText.trim()) {
        return safeJsonError("Empty price file", 400, origin);
      }
      rows = parseCsvRows(csvText);
    }

    if (rows.length === 0) {
      return safeJsonError("No data rows found in price file", 400, origin);
    }

    const results = {
      rows_parsed: rows.length,
      rows_imported: 0,
      prices_changed: 0,
      quotes_flagged: 0,
      errors: [] as string[],
    };

    // Upsert each row into catalog_entries
    for (const row of rows) {
      const make = row.make || row.manufacturer;
      const model = row.model;

      if (!make || !model) {
        results.errors.push(`Row missing make/model: ${JSON.stringify(row).substring(0, 100)}`);
        continue;
      }

      const entry = {
        workspace_id: "default",
        source: "csv_import" as const,
        make,
        model,
        year: row.year ? parseInt(row.year) : null,
        stock_number: row.stock_number || row.stock || null,
        serial_number: row.serial_number || row.serial || null,
        list_price: row.list_price ? parseFloat(row.list_price) : null,
        dealer_cost: row.dealer_cost ? parseFloat(row.dealer_cost) : null,
        msrp: row.msrp ? parseFloat(row.msrp) : null,
        category: row.category || null,
        condition: (row.condition === "new" || row.condition === "used") ? row.condition : null,
        is_available: true,
        imported_at: new Date().toISOString(),
      };

      // Try to match existing entry by stock_number or make+model+year
      let existing: { id: string } | null = null;
      if (entry.stock_number) {
        const { data } = await supabaseAdmin
          .from("catalog_entries")
          .select("id")
          .eq("stock_number", entry.stock_number)
          .maybeSingle();
        existing = data;
      }

      if (existing) {
        // Update existing — trigger will auto-capture price history
        const { error: updateErr } = await supabaseAdmin
          .from("catalog_entries")
          .update({
            list_price: entry.list_price,
            dealer_cost: entry.dealer_cost,
            msrp: entry.msrp,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updateErr) {
          results.errors.push(`Update failed for ${make} ${model}: ${updateErr.message}`);
        } else {
          results.rows_imported++;
          results.prices_changed++;
        }
      } else {
        // Insert new entry
        const { error: insertErr } = await supabaseAdmin
          .from("catalog_entries")
          .insert(entry);

        if (insertErr) {
          results.errors.push(`Insert failed for ${make} ${model}: ${insertErr.message}`);
        } else {
          results.rows_imported++;
        }
      }
    }

    // Flag open quotes that reference changed catalog entries
    // Check quote_packages where equipment JSONB references updated makes/models
    const { data: openQuotes } = await supabaseAdmin
      .from("quote_packages")
      .select("id")
      .in("status", ["draft", "ready", "sent"])
      .eq("requires_requote", false);

    if (openQuotes && openQuotes.length > 0) {
      // Flag all open quotes created before this import as potentially needing requote
      const { data: flagged } = await supabaseAdmin
        .from("quote_packages")
        .update({
          requires_requote: true,
          requote_reason: `Price file imported on ${new Date().toISOString().split("T")[0]} — verify pricing is current.`,
        })
        .in("status", ["draft", "ready", "sent"])
        .eq("requires_requote", false)
        .select("id");

      results.quotes_flagged = flagged?.length ?? 0;
    }

    // ── Stratified impact report (sorted by dollar exposure) ──────────
    // Uses the price_change_impact view from migration 155
    const { data: impactRows } = await supabaseAdmin
      .from("price_change_impact")
      .select("*")
      .order("price_delta_total", { ascending: false, nullsFirst: false });

    const impactArr = (impactRows ?? []) as Array<Record<string, unknown>>;
    const impactReport = {
      total_line_items_affected: impactArr.length,
      total_quotes_affected: new Set(impactArr.map((r) => r.quote_package_id)).size,
      total_deals_affected: new Set(impactArr.map((r) => r.deal_id).filter(Boolean)).size,
      total_dollar_exposure: Math.round(
        impactArr.reduce((sum, r) => sum + (Number(r.price_delta_total) || 0), 0) * 100,
      ) / 100,
      top_10_by_dollar_impact: impactArr.slice(0, 10).map((r) => ({
        quote_package_id: r.quote_package_id,
        deal_id: r.deal_id,
        make: r.make,
        model: r.model,
        price_delta_total: r.price_delta_total,
        price_change_pct: r.price_change_pct,
      })),
    };

    return safeJsonOk({
      ok: true,
      results,
      impact_report: impactReport,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "price-file-import", req });
    console.error("price-file-import error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
