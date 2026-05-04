/**
 * Parts Bulk Import — Parts Intelligence Engine ingestion surface.
 *
 * Actions:
 *   - preview:  reads file from Storage → parses → writes preview_diff to parts_import_runs
 *               (status = 'previewing' or 'awaiting_conflicts' if conflicts exist)
 *   - commit:   applies a previewed run → upserts parts_catalog + parts_history_monthly /
 *               parts_vendor_prices / vendor_profiles+contacts+schedules, resolving conflicts
 *   - cancel:   marks a pending/previewing run as cancelled
 *   - status:   returns current status of a run
 *
 * File types auto-detected by header signature. Idempotent on file hash.
 * Honors manual_override flags → queues conflicts instead of silent overwrite.
 *
 * Auth: admin / manager / owner only.
 */

import XLSX from "npm:xlsx@0.18.5";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  FIELD_PRIORITY,
  type ImportOptions,
  type PartsImportFileType,
  type PartsImportStatus,
  type PreviewStats,
  sha256,
} from "../_shared/parts-import-types.ts";
import {
  looksLikePartmast,
  parsePartmastRow,
  previewPartmast,
  toPartsCatalogUpsert,
  type PartmastImportPlan,
  type PartmastParsed,
} from "../_shared/parts-import-partmast.ts";
import {
  detectPartNumberColumn,
  detectPriceColumn,
  looksLikeVendorPriceFile,
  parseVendorPriceRow,
  type VendorPriceParsed,
} from "../_shared/parts-import-vendor-price.ts";
import {
  looksLikeVendorContactsWorkbook,
  parseContactsSheet,
  parseOrderingScheduleSheet,
  type VendorContactGroup,
  type VendorOrderScheduleParsed,
} from "../_shared/parts-import-vendor-contacts.ts";

// ── types ───────────────────────────────────────────────────────────────────

interface RequestBody {
  action: "preview" | "commit" | "cancel" | "status";
  storage_path?: string;
  source_file_name?: string;
  file_type_hint?: PartsImportFileType;
  vendor_id?: string | null;
  vendor_code?: string | null;
  branch_scope?: string | null;
  effective_date?: string | null;
  run_id?: string;
  options?: ImportOptions;
}

// ── entrypoint ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["admin", "manager", "owner"].includes(auth.role)) {
      return safeJsonError("parts bulk import requires admin/manager/owner role", 403, origin);
    }

    const body = (await req.json()) as RequestBody;
    const supabase = auth.supabase;
    const actorId = auth.userId;

    switch (body.action) {
      case "preview":
        return await handlePreview(supabase, body, actorId, origin);
      case "commit":
        return await handleCommit(supabase, body, actorId, origin);
      case "cancel":
        return await handleCancel(supabase, body, origin);
      case "status":
        return await handleStatus(supabase, body, origin);
      default:
        return safeJsonError(`unknown action: ${body.action}`, 400, origin);
    }
  } catch (err) {
    captureEdgeException(err, { fn: "parts-bulk-import" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function getWorkspace(supabase: SupabaseClient, actorId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", actorId)
    .maybeSingle();
  if (error || !data?.workspace_id) {
    throw new Error("unable to resolve workspace for caller");
  }
  return data.workspace_id;
}

/** Load a file from Supabase Storage via service role. */
async function readStorageFile(
  storagePath: string,
): Promise<{ buffer: ArrayBuffer; hash: string; size: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  const [bucket, ...rest] = storagePath.split("/");
  const path = rest.join("/");
  const { data, error } = await svc.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`storage download failed: ${error?.message ?? "no data"}`);
  }
  const buffer = await data.arrayBuffer();
  return { buffer, hash: await sha256(buffer), size: buffer.byteLength };
}

function detectFileType(workbook: XLSX.WorkBook, hint?: PartsImportFileType): PartsImportFileType {
  if (hint && hint !== "unknown") return hint;

  if (looksLikeVendorContactsWorkbook(workbook)) return "vendor_contacts";

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return "unknown";

  const headerRows = XLSX.utils.sheet_to_json<unknown>(firstSheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const headers = (headerRows[0] as string[] ?? []).map((h) => String(h ?? "").trim());

  if (looksLikePartmast(headers)) return "partmast";
  if (looksLikeVendorPriceFile(headers)) return "vendor_price";
  return "unknown";
}

// ── preview ─────────────────────────────────────────────────────────────────

async function handlePreview(
  supabase: SupabaseClient,
  body: RequestBody,
  actorId: string,
  origin: string | null,
): Promise<Response> {
  if (!body.storage_path || !body.source_file_name) {
    return safeJsonError("storage_path and source_file_name required", 400, origin);
  }

  const workspaceId = await getWorkspace(supabase, actorId);
  const { buffer, hash, size } = await readStorageFile(body.storage_path);

  // Dedup: if the same hash is already committed for this workspace + file_type, short-circuit.
  const { data: priorRuns } = await supabase
    .from("parts_import_runs")
    .select("id, status, file_type, completed_at, rows_inserted, rows_updated")
    .eq("workspace_id", workspaceId)
    .eq("source_file_hash", hash)
    .order("started_at", { ascending: false })
    .limit(5);

  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const fileType = detectFileType(workbook, body.file_type_hint);

  // Create run record in 'parsing' state
  const { data: runRow, error: runErr } = await supabase
    .from("parts_import_runs")
    .insert({
      workspace_id: workspaceId,
      uploaded_by: actorId,
      source_file_name: body.source_file_name,
      source_file_hash: hash,
      source_storage_path: body.storage_path,
      file_type: fileType,
      vendor_id: body.vendor_id ?? null,
      vendor_code: body.vendor_code ?? null,
      branch_scope: body.branch_scope ?? null,
      status: "parsing" as PartsImportStatus,
      options: body.options ?? {},
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return safeJsonError(`failed to create import run: ${runErr?.message}`, 500, origin);
  }
  const runId = runRow.id;

  try {
    let stats: PreviewStats;
    let plan: unknown;

    if (fileType === "partmast") {
      const parsed = parsePartmastWorkbook(workbook);
      const { stats: s, plan: p } = await previewPartmast(supabase, workspaceId, parsed.rows, body.options ?? { commit: false });
      s.rows_errored = parsed.errors.length;
      s.errors = parsed.errors;
      stats = s;
      plan = p;
    } else if (fileType === "vendor_price") {
      const parsed = parseVendorPriceWorkbook(workbook, body.effective_date ?? new Date().toISOString().slice(0, 10));
      stats = vendorPricePreviewStats(parsed);
      plan = parsed;
    } else if (fileType === "vendor_contacts") {
      const parsed = parseVendorContactsWorkbook(workbook);
      stats = vendorContactsPreviewStats(parsed);
      plan = parsed;
    } else {
      await supabase
        .from("parts_import_runs")
        .update({ status: "failed" as PartsImportStatus, error_log: { reason: "unknown file type" }, completed_at: new Date().toISOString() })
        .eq("id", runId);
      return safeJsonError("could not detect file type — please set file_type_hint", 422, origin);
    }

    const newStatus: PartsImportStatus = stats.rows_conflicted > 0 ? "awaiting_conflicts" : "previewing";

    await supabase
      .from("parts_import_runs")
      .update({
        status: newStatus,
        row_count: stats.rows_scanned,
        rows_inserted: stats.rows_to_insert,
        rows_updated: stats.rows_to_update,
        rows_skipped: stats.rows_unchanged,
        rows_errored: stats.rows_errored,
        rows_conflicted: stats.rows_conflicted,
        preview_diff: sanitizeForJsonb({ stats, plan_meta: summarizePlan(plan) }),
      })
      .eq("id", runId);

    // Persist conflicts (if partmast)
    if (fileType === "partmast") {
      const p = plan as PartmastImportPlan;
      if (p.conflicts.length > 0) {
        const rows = p.conflicts.map((c) => ({
          workspace_id: workspaceId,
          run_id: runId,
          part_id: c.part_id,
          part_number: c.part_number,
          field_name: c.field_name,
          field_label: prettyFieldLabel(c.field_name),
          current_value: valueToJsonb(c.current_value),
          current_set_by: c.current_set_by,
          current_set_at: c.current_set_at,
          incoming_value: valueToJsonb(c.incoming_value),
          incoming_source: body.source_file_name,
          priority: c.priority,
        }));
        // Batch insert in chunks of 500
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await supabase.from("parts_import_conflicts").insert(chunk);
          if (error) throw new Error(`conflict insert failed: ${error.message}`);
        }
      }
    }

    // Stash parsed plan in storage for commit phase (avoids re-parsing 3MB file).
    await stashPlan(body.storage_path, runId, { fileType, plan });

    return safeJsonOk({
      run_id: runId,
      status: newStatus,
      file_type: fileType,
      file_size_bytes: size,
      file_hash: hash,
      stats,
      duplicate_of: priorRuns?.find((r) => r.status === "committed" && r.id !== runId) ?? null,
    }, origin);
  } catch (err) {
    await supabase
      .from("parts_import_runs")
      .update({
        status: "failed",
        error_log: { message: (err as Error).message, stack: (err as Error).stack },
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw err;
  }
}

// ── commit ──────────────────────────────────────────────────────────────────

async function handleCommit(
  supabase: SupabaseClient,
  body: RequestBody,
  actorId: string,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required for commit", 400, origin);

  const workspaceId = await getWorkspace(supabase, actorId);

  const { data: run, error: runErr } = await supabase
    .from("parts_import_runs")
    .select("*")
    .eq("id", body.run_id)
    .eq("workspace_id", workspaceId)
    .single();

  if (runErr || !run) return safeJsonError("import run not found", 404, origin);
  if (!["previewing", "awaiting_conflicts"].includes(run.status)) {
    return safeJsonError(`run is in status '${run.status}' — cannot commit`, 409, origin);
  }

  // Block commit if unresolved high-priority conflicts remain
  const { data: unresolved, count } = await supabase
    .from("parts_import_conflicts")
    .select("id, priority", { count: "exact", head: false })
    .eq("run_id", run.id)
    .is("resolution", null);

  const highPriorityUnresolved = (unresolved ?? []).filter((c) => c.priority === "high").length;
  if (highPriorityUnresolved > 0) {
    return safeJsonError(
      `${highPriorityUnresolved} high-priority conflicts still unresolved — resolve before commit`,
      409,
      origin,
    );
  }

  await supabase
    .from("parts_import_runs")
    .update({ status: "committing" as PartsImportStatus })
    .eq("id", run.id);

  try {
    const stash = await readStashedPlan(run.source_storage_path, run.id);
    let inserted = 0, updated = 0;

    if (run.file_type === "partmast") {
      const result = await commitPartmast(supabase, workspaceId, run.id, stash.plan as PartmastImportPlan);
      inserted = result.inserted;
      updated = result.updated;
    } else if (run.file_type === "vendor_price") {
      const result = await commitVendorPrice(supabase, workspaceId, run.id, run.vendor_id, stash.plan as VendorPriceParsed[], body.source_file_name ?? run.source_file_name);
      inserted = result.inserted;
    } else if (run.file_type === "vendor_contacts") {
      const result = await commitVendorContacts(supabase, workspaceId, stash.plan as { groups: VendorContactGroup[]; schedules: VendorOrderScheduleParsed[] });
      inserted = result.profiles_inserted + result.contacts_inserted + result.schedules_inserted;
    }

    await supabase
      .from("parts_import_runs")
      .update({
        status: "committed" as PartsImportStatus,
        rows_inserted: inserted,
        rows_updated: updated,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return safeJsonOk({
      run_id: run.id,
      status: "committed",
      rows_inserted: inserted,
      rows_updated: updated,
    }, origin);
  } catch (err) {
    await supabase
      .from("parts_import_runs")
      .update({
        status: "failed" as PartsImportStatus,
        error_log: { stage: "commit", message: (err as Error).message, stack: (err as Error).stack },
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw err;
  }
}

async function handleCancel(
  supabase: SupabaseClient,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);
  const { error } = await supabase
    .from("parts_import_runs")
    .update({ status: "cancelled" as PartsImportStatus, completed_at: new Date().toISOString() })
    .eq("id", body.run_id)
    .in("status", ["pending", "parsing", "previewing", "awaiting_conflicts"]);
  if (error) return safeJsonError(error.message, 500, origin);
  return safeJsonOk({ run_id: body.run_id, status: "cancelled" }, origin);
}

async function handleStatus(
  supabase: SupabaseClient,
  body: RequestBody,
  origin: string | null,
): Promise<Response> {
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);
  const { data, error } = await supabase
    .from("parts_import_runs")
    .select("*")
    .eq("id", body.run_id)
    .single();
  if (error || !data) return safeJsonError("run not found", 404, origin);
  return safeJsonOk({ run: data }, origin);
}

// ── parsers ─────────────────────────────────────────────────────────────────

function parsePartmastWorkbook(workbook: XLSX.WorkBook): {
  rows: PartmastParsed[];
  errors: Array<{ row: number; part_number?: string; reason: string }>;
} {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const rows: PartmastParsed[] = [];
  const errors: Array<{ row: number; part_number?: string; reason: string }> = [];

  rawRows.forEach((row, idx) => {
    const parsed = parsePartmastRow(row);
    if ("error" in parsed) {
      errors.push({ row: idx + 2, reason: parsed.error });
    } else {
      rows.push(parsed);
    }
  });

  return { rows, errors };
}

function parseVendorPriceWorkbook(
  workbook: XLSX.WorkBook,
  effectiveDate: string,
): VendorPriceParsed[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  if (rawRows.length === 0) return [];
  const headers = Object.keys(rawRows[0]);
  const pnCol = detectPartNumberColumn(headers);
  const priceCol = detectPriceColumn(headers);
  if (!pnCol || !priceCol) {
    throw new Error(`vendor price file missing required columns (part_number / price). Headers: ${headers.join(", ")}`);
  }

  const result: VendorPriceParsed[] = [];
  for (const row of rawRows) {
    const parsed = parseVendorPriceRow(row, {
      part_number_col: pnCol,
      price_col: priceCol,
      effective_date: effectiveDate,
    });
    if (!("error" in parsed)) result.push(parsed);
  }
  return result;
}

function parseVendorContactsWorkbook(workbook: XLSX.WorkBook): {
  groups: VendorContactGroup[];
  schedules: VendorOrderScheduleParsed[];
} {
  const groups: VendorContactGroup[] = [];
  const schedules: VendorOrderScheduleParsed[] = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const low = name.toLowerCase();
    if (low.includes("parts contacts") || low === "parts contacts") {
      groups.push(...parseContactsSheet(sheet, "parts", name));
    } else if (low.includes("service contacts")) {
      groups.push(...parseContactsSheet(sheet, "service", name));
    } else if (low.includes("admin contacts")) {
      groups.push(...parseContactsSheet(sheet, "admin", name));
    } else if (low.includes("ordering schedule")) {
      schedules.push(...parseOrderingScheduleSheet(sheet));
    }
  }

  return { groups, schedules };
}

// ── stats / commit ──────────────────────────────────────────────────────────

function vendorPricePreviewStats(rows: VendorPriceParsed[]): PreviewStats {
  return {
    rows_scanned: rows.length,
    rows_to_insert: rows.length,
    rows_to_update: 0,
    rows_unchanged: 0,
    rows_errored: 0,
    rows_conflicted: 0,
    sample_inserts: rows.slice(0, 10).map((r) => ({
      part_number: r.part_number,
      description: r.description,
      list_price: r.list_price,
      product_code: r.product_code,
    })),
    sample_updates: [],
    errors: [],
  };
}

function vendorContactsPreviewStats(data: {
  groups: VendorContactGroup[];
  schedules: VendorOrderScheduleParsed[];
}): PreviewStats {
  const contacts = data.groups.reduce((sum, g) => sum + g.contacts.length, 0);
  return {
    rows_scanned: contacts + data.schedules.length,
    rows_to_insert: contacts + data.schedules.length,
    rows_to_update: 0,
    rows_unchanged: 0,
    rows_errored: 0,
    rows_conflicted: 0,
    sample_inserts: data.groups.slice(0, 10).map((g) => ({
      company: g.company,
      contact_count: g.contacts.length,
      first_contact: g.contacts[0]?.contact_name,
    })),
    sample_updates: [],
    errors: [],
  };
}

async function commitPartmast(
  supabase: SupabaseClient,
  workspaceId: string,
  runId: string,
  plan: PartmastImportPlan,
): Promise<{ inserted: number; updated: number }> {
  // 1. Apply accepted conflict resolutions (overrides may remove certain fields from update set)
  const { data: resolvedConflicts } = await supabase
    .from("parts_import_conflicts")
    .select("part_id, field_name, resolution, resolution_value, incoming_value")
    .eq("run_id", runId)
    .not("resolution", "is", null);

  const keepCurrentByPart = new Map<string, Set<string>>();
  const customByPart = new Map<string, Map<string, unknown>>();
  for (const r of resolvedConflicts ?? []) {
    if (r.resolution === "keep_current") {
      if (!keepCurrentByPart.has(r.part_id)) keepCurrentByPart.set(r.part_id, new Set());
      keepCurrentByPart.get(r.part_id)!.add(r.field_name);
    } else if (r.resolution === "custom") {
      if (!customByPart.has(r.part_id)) customByPart.set(r.part_id, new Map());
      customByPart.get(r.part_id)!.set(r.field_name, r.resolution_value);
    }
  }

  // 2. Upsert inserts in batches
  let inserted = 0;
  const allInserts = plan.inserts.map((p) => toPartsCatalogUpsert(p, workspaceId, runId));
  for (let i = 0; i < allInserts.length; i += 250) {
    const chunk = allInserts.slice(i, i + 250);
    const { error } = await supabase.from("parts_catalog").insert(chunk);
    if (error) throw new Error(`insert batch failed at ${i}: ${error.message}`);
    inserted += chunk.length;
  }

  // 3. Updates — one by one to honor per-field keep_current (could batch via RPC later)
  let updated = 0;
  for (const u of plan.updates) {
    const keepSet = keepCurrentByPart.get(u.existing.id) ?? new Set<string>();
    const customMap = customByPart.get(u.existing.id) ?? new Map<string, unknown>();

    const payload = toPartsCatalogUpsert(u.parsed, workspaceId, runId) as Record<string, unknown>;
    // strip "keep_current" fields from payload so existing value wins
    for (const f of keepSet) {
      delete payload[f];
    }
    // apply custom values
    for (const [f, v] of customMap.entries()) {
      payload[f] = v;
    }
    // Suppress the manual-edit tracker for this import path
    const { error: txErr } = await supabase.rpc("exec_suppress_override_update", {
      p_part_id: u.existing.id,
      p_payload: payload,
    }).single();

    if (txErr) {
      // Fall back to plain update if the RPC isn't available
      const { error } = await supabase
        .from("parts_catalog")
        .update(payload)
        .eq("id", u.existing.id);
      if (error) throw new Error(`update failed for ${u.parsed.part_number}: ${error.message}`);
    }
    updated++;
  }

  // 4. Insert history rows (upsert by (part_id, month_offset))
  const historyRows: Array<Record<string, unknown>> = [];
  for (const p of [...plan.inserts, ...plan.updates.map((u) => u.parsed)]) {
    for (const h of p.history) {
      historyRows.push({
        workspace_id: workspaceId,
        part_id: undefined, // resolved by trigger on actual insert path — see note below
        month_offset: h.month_offset,
        sales_qty: h.sales_qty,
        bin_trips: h.bin_trips,
        demands: h.demands,
        source_import_run_id: runId,
      });
    }
  }
  // NOTE: history upsert is resolved in a follow-up pass so we can look up part_ids.
  await resolveAndUpsertHistory(supabase, workspaceId, runId, [...plan.inserts, ...plan.updates.map((u) => u.parsed)]);

  return { inserted, updated };
}

async function resolveAndUpsertHistory(
  supabase: SupabaseClient,
  workspaceId: string,
  runId: string,
  parts: PartmastParsed[],
): Promise<void> {
  // Resolve part IDs
  const keyToPart = new Map<string, PartmastParsed>();
  for (const p of parts) {
    const key = `${p.co_code}|${p.div_code}|${p.branch_code}|${p.part_number}`;
    keyToPart.set(key, p);
  }
  const pns = Array.from(new Set(parts.map((p) => p.part_number)));
  const idMap = new Map<string, string>();
  for (let i = 0; i < pns.length; i += 1000) {
    const chunk = pns.slice(i, i + 1000);
    const { data } = await supabase
      .from("parts_catalog")
      .select("id, part_number, co_code, div_code, branch_code")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .in("part_number", chunk);
    for (const r of data ?? []) {
      const key = `${r.co_code ?? ""}|${r.div_code ?? ""}|${r.branch_code ?? ""}|${r.part_number}`;
      idMap.set(key, r.id);
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const p of parts) {
    const key = `${p.co_code}|${p.div_code}|${p.branch_code}|${p.part_number}`;
    const partId = idMap.get(key);
    if (!partId) continue;
    for (const h of p.history) {
      rows.push({
        workspace_id: workspaceId,
        part_id: partId,
        month_offset: h.month_offset,
        sales_qty: h.sales_qty,
        bin_trips: h.bin_trips,
        demands: h.demands,
        source_import_run_id: runId,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("parts_history_monthly")
      .upsert(chunk, { onConflict: "part_id,month_offset" });
    if (error) throw new Error(`history upsert failed at ${i}: ${error.message}`);
  }
}

async function commitVendorPrice(
  supabase: SupabaseClient,
  workspaceId: string,
  runId: string,
  vendorId: string | null,
  rows: VendorPriceParsed[],
  sourceFile: string,
): Promise<{ inserted: number }> {
  if (!vendorId) throw new Error("vendor_id required for vendor_price imports");
  const payload = rows.map((r) => ({
    workspace_id: workspaceId,
    vendor_id: vendorId,
    part_number: r.part_number,
    description: r.description,
    description_fr: r.description_fr,
    list_price: r.list_price,
    product_code: r.product_code,
    effective_date: r.effective_date,
    source_file: sourceFile,
    source_import_run_id: runId,
  }));
  let inserted = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await supabase
      .from("parts_vendor_prices")
      .upsert(chunk, { onConflict: "vendor_id,part_number,effective_date" });
    if (error) throw new Error(`vendor_price upsert failed at ${i}: ${error.message}`);
    inserted += chunk.length;
  }
  return { inserted };
}

async function commitVendorContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  data: { groups: VendorContactGroup[]; schedules: VendorOrderScheduleParsed[] },
): Promise<{ profiles_inserted: number; contacts_inserted: number; schedules_inserted: number }> {
  let profilesInserted = 0;
  let contactsInserted = 0;
  let schedulesInserted = 0;

  // Upsert vendor profiles by (workspace_id, lower(name))
  for (const g of data.groups) {
    const { data: existingVendor } = await supabase
      .from("vendor_profiles")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", g.company)
      .maybeSingle();

    let vendorId = existingVendor?.id ?? null;
    if (!vendorId) {
      const { data: ins, error } = await supabase
        .from("vendor_profiles")
        .insert({ workspace_id: workspaceId, name: g.company, supplier_type: "general" })
        .select("id")
        .single();
      if (error) throw new Error(`vendor_profiles insert failed: ${error.message}`);
      vendorId = ins.id;
      profilesInserted++;
    }

    for (const c of g.contacts) {
      const { data: existing } = await supabase
        .from("vendor_contacts")
        .select("id")
        .eq("vendor_id", vendorId!)
        .eq("contact_name", c.contact_name)
        .maybeSingle();
      if (existing?.id) continue;
      const { error } = await supabase
        .from("vendor_contacts")
        .insert({
          workspace_id: workspaceId,
          vendor_id: vendorId,
          contact_name: c.contact_name,
          role: c.title,
          phone: [c.phone, c.ext].filter(Boolean).join(" x"),
          email: c.email,
          escalation_tier: c.tier,
          notes: c.notes,
          is_primary: c.tier === 1,
        });
      if (error) throw new Error(`vendor_contacts insert failed: ${error.message}`);
      contactsInserted++;
    }
  }

  for (const s of data.schedules) {
    // Resolve vendor by code or name
    let vendorId: string | null = null;
    if (s.vendor_name) {
      const { data } = await supabase
        .from("vendor_profiles")
        .select("id")
        .eq("workspace_id", workspaceId)
        .ilike("name", s.vendor_name)
        .maybeSingle();
      vendorId = data?.id ?? null;
    }
    if (!vendorId) continue;

    const { error } = await supabase
      .from("vendor_order_schedules")
      .upsert(
        {
          workspace_id: workspaceId,
          vendor_id: vendorId,
          vendor_code: s.vendor_code,
          branch_code: s.branch ?? "",
          frequency: s.frequency,
          day_of_week: s.day_of_week,
          notes: s.notes,
        },
        { onConflict: "vendor_id,branch_code,frequency,day_of_week" },
      );
    if (error) throw new Error(`schedule upsert failed: ${error.message}`);
    schedulesInserted++;
  }

  return { profiles_inserted: profilesInserted, contacts_inserted: contactsInserted, schedules_inserted: schedulesInserted };
}

// ── utilities ───────────────────────────────────────────────────────────────

function summarizePlan(plan: unknown): Record<string, unknown> {
  if (!plan) return {};
  const obj = plan as { inserts?: unknown[]; updates?: unknown[]; conflicts?: unknown[] };
  if (Array.isArray(obj)) {
    return { count: obj.length };
  }
  return {
    inserts: obj.inserts?.length ?? 0,
    updates: obj.updates?.length ?? 0,
    conflicts: obj.conflicts?.length ?? 0,
  };
}

function prettyFieldLabel(field: string): string {
  return field
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function valueToJsonb(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

function sanitizeForJsonb(obj: unknown): unknown {
  // Replace circular / undefined / huge payloads
  const seen = new WeakSet();
  function walk(v: unknown): unknown {
    if (v == null) return v;
    if (typeof v === "object") {
      if (seen.has(v as object)) return "[circular]";
      seen.add(v as object);
      if (Array.isArray(v)) return v.map(walk);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  }
  return walk(obj);
}

/** Persist the parsed plan to Storage next to the source file for later commit. */
async function stashPlan(storagePath: string, runId: string, plan: unknown): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);
  const [bucket, ...rest] = storagePath.split("/");
  const stashPath = [...rest.slice(0, -1), `.plan-${runId}.json`].join("/");
  const blob = new Blob([JSON.stringify(plan)], { type: "application/json" });
  await svc.storage.from(bucket).upload(stashPath, blob, { upsert: true });
}

async function readStashedPlan(storagePath: string, runId: string): Promise<{ fileType: PartsImportFileType; plan: unknown }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);
  const [bucket, ...rest] = storagePath.split("/");
  const stashPath = [...rest.slice(0, -1), `.plan-${runId}.json`].join("/");
  const { data, error } = await svc.storage.from(bucket).download(stashPath);
  if (error || !data) throw new Error(`stashed plan not found: ${error?.message}`);
  const text = await data.text();
  return JSON.parse(text);
}
