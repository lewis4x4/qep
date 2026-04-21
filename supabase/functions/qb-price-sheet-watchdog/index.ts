/**
 * qb-price-sheet-watchdog — Slice 16.
 *
 * Poll URL-based price-sheet sources on a cadence. When the hash
 * changes we download the body, stash it in Storage, insert a
 * qb_price_sheets row in pending_review, and fire extract-price-sheet
 * to trigger the existing Claude extraction + approval pipeline.
 *
 * Two invocation modes:
 *
 *   1. Manual trigger (admin hits "Check now" on a single source):
 *        POST body: { sourceId: "<uuid>", manualTrigger: true }
 *      → runs that one source regardless of cadence.
 *
 *   2. Batch tick (cron or ad-hoc /bulk ping):
 *        POST body: { } or { batch: true }
 *      → picks every active source where isOverdue(source) === true
 *        and runs each in sequence. Sequential (not parallel) so we
 *        don't stampede the extract-price-sheet edge function.
 *
 * Events written to qb_sheet_watch_events are the source of truth
 * for the admin health strip + timeline UI.
 *
 * Failure policy:
 *   - A poll error bumps consecutive_failures, sets last_error,
 *     writes an 'error' event, emits an admin flare. After 3
 *     consecutive failures the sources admin UI flags the source
 *     unhealthy.
 *   - A successful poll clears consecutive_failures and last_error.
 *
 * Auth: requires user JWT + admin/manager/owner role. The scheduled
 * caller will use a service role JWT → see _shared/cron-auth.ts
 * for follow-up (Slice 16 ships admin-only; cron wiring is CP6
 * defer).
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { emitAdminFlare } from "../_shared/admin-flare.ts";
import {
  sha256Hex,
  detectHashChange,
  isOverdue,
  resolveContentType,
  buildStoragePath,
  buildAutoFilename,
  fetchWithCache,
} from "./poll-logic.ts";

type SourceRow = {
  id: string;
  workspace_id: string;
  brand_id: string;
  label: string;
  url: string | null;
  check_freq_hours: number;
  last_checked_at: string | null;
  last_hash: string | null;
  last_etag: string | null;
  last_http_status: number | null;
  last_error: string | null;
  consecutive_failures: number;
  active: boolean;
};

type BrandRow = { id: string; name: string; code: string };

type CheckOutcome =
  | { kind: "checked_unchanged"; httpStatus: number }
  | { kind: "change_detected"; priceSheetId: string; httpStatus: number; oldHash: string | null; newHash: string }
  | { kind: "sheet_extracted"; priceSheetId: string }
  | { kind: "error"; message: string; stage: string };

// ── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  // Two accepted caller identities:
  //   1. Admin/manager/owner user JWT — from the "Check now" button in
  //      the admin UI. Populates auth.userId so manual_trigger events
  //      can attribute the click.
  //   2. pg_cron via x-internal-service-secret OR service_role bearer —
  //      from migration 307's 15-minute schedule. No user attribution;
  //      manual_trigger events are skipped (batch mode only).
  //
  // Ordering matters: check the cron path first because cron requests
  // carry only the internal-service-secret header, no JWT, so the JWT
  // path would 401 them needlessly.
  const cronCaller = isServiceRoleCaller(req);
  let userIdForAudit: string | null = null;
  // Non-null only when cronCaller is false — used to gate user-initiated
  // single-source triggers to the caller's own workspace.
  let callerWorkspaceId: string | null = null;
  if (!cronCaller) {
    const auth = await requireServiceUser(req.headers.get("authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["admin", "manager", "owner"].includes(auth.role)) {
      return safeJsonError("Watchdog requires admin, manager, or owner role", 403, origin);
    }
    userIdForAudit = auth.userId;
    callerWorkspaceId = auth.workspaceId;
  }

  const parsed = await parseJsonBody(req, origin);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { sourceId?: string; manualTrigger?: boolean; batch?: boolean };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service     = createClient(supabaseUrl, serviceKey);

  // ── Load sources to process ────────────────────────────────────────────
  let sources: SourceRow[];
  if (body.sourceId) {
    const { data, error } = await service
      .from("qb_brand_sheet_sources")
      .select("*")
      .eq("id", body.sourceId)
      .maybeSingle();
    if (error) {
      console.error("[qb-price-sheet-watchdog] load source failed:", error);
      return safeJsonError("Load source failed", 500, origin);
    }
    if (!data)  return safeJsonError("Source not found", 404, origin);
    // Workspace isolation: user-initiated triggers must be confined to the
    // caller's own workspace even though the service-role client bypasses RLS.
    // Cron callers skip this check (cron runs globally).
    if (!cronCaller && callerWorkspaceId && (data as SourceRow).workspace_id !== callerWorkspaceId) {
      return safeJsonError("Source not found", 404, origin);
    }
    sources = [data as SourceRow];
  } else {
    const { data, error } = await service
      .from("qb_brand_sheet_sources")
      .select("*")
      .eq("active", true);
    if (error) {
      console.error("[qb-price-sheet-watchdog] load sources failed:", error);
      return safeJsonError("Load sources failed", 500, origin);
    }
    const now = new Date();
    sources = (data as SourceRow[] ?? []).filter((s) => isOverdue(s, now));
  }

  if (sources.length === 0) {
    return safeJsonOk({ ok: true, message: "No sources due for check", processed: 0 }, origin);
  }

  // ── Process each source in sequence ────────────────────────────────────
  // Per-source wall so a stalled fetch/parse on one source can't starve
  // later sources in the same batch. 20 s = 15 s fetch + 5 s headroom for
  // storage write + hash + extract dispatch. Beyond that we record a
  // timeout error and move on; the next cron tick will retry.
  const PER_SOURCE_BUDGET_MS = 20_000;
  const results: Array<{ sourceId: string; outcome: CheckOutcome }> = [];

  for (const source of sources) {
    // Log the manual_trigger event upfront so the admin UI sees an immediate entry.
    // Cron-initiated batches never carry manualTrigger=true, so this branch is
    // skipped for scheduled runs even when a sourceId happens to be set.
    if (body.manualTrigger && body.sourceId === source.id && userIdForAudit) {
      await service.from("qb_sheet_watch_events").insert({
        workspace_id: source.workspace_id,
        source_id:    source.id,
        event_type:   "manual_trigger",
        detail:       { triggered_by_user: userIdForAudit },
      });
    }

    const outcome = await withTimeout(
      processSource(service, source),
      PER_SOURCE_BUDGET_MS,
      async () => await recordError(service, source, "Source processing exceeded 20s budget", "timeout"),
    );
    results.push({ sourceId: source.id, outcome });
  }

  return safeJsonOk({ ok: true, processed: results.length, results }, origin);
});

/**
 * Race a promise against a wall-clock deadline. On timeout, invoke the
 * fallback (typically recordError) and return its result so the batch
 * loop gets a structured CheckOutcome either way.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  onTimeout: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"__timeout__">((resolve) => {
    timer = setTimeout(() => resolve("__timeout__"), ms);
  });
  const winner = await Promise.race([p, timeout]);
  if (timer) clearTimeout(timer);
  if (winner === "__timeout__") {
    return await onTimeout();
  }
  return winner as T;
}

// ── Per-source pipeline ──────────────────────────────────────────────────

async function processSource(
  service: SupabaseClient,
  source: SourceRow,
): Promise<CheckOutcome> {
  const now = new Date();

  if (!source.url) {
    return await recordError(service, source, "Source has no URL configured", "config");
  }

  // 1. Fetch (with conditional If-None-Match where possible)
  let fetched;
  try {
    fetched = await fetchWithCache(source.url, source.last_etag);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return await recordError(service, source, message, "fetch");
  }

  // 304 → record unchanged, bump last_checked_at + clear error state
  if (fetched.kind === "not_modified") {
    await service
      .from("qb_brand_sheet_sources")
      .update({
        last_checked_at: now.toISOString(),
        last_http_status: 304,
        last_error: null,
        consecutive_failures: 0,
      })
      .eq("id", source.id);
    await service.from("qb_sheet_watch_events").insert({
      workspace_id: source.workspace_id,
      source_id:    source.id,
      event_type:   "checked_unchanged",
      detail:       { http_status: 304, via: "etag" },
    });
    return { kind: "checked_unchanged", httpStatus: 304 };
  }

  // 2. Hash the body
  const newHash = await sha256Hex(fetched.bytes);
  const change = detectHashChange(source.last_hash, newHash);

  if (change === "unchanged") {
    await service
      .from("qb_brand_sheet_sources")
      .update({
        last_checked_at: now.toISOString(),
        last_http_status: fetched.httpStatus,
        last_etag: fetched.etag ?? source.last_etag,
        last_error: null,
        consecutive_failures: 0,
      })
      .eq("id", source.id);
    await service.from("qb_sheet_watch_events").insert({
      workspace_id: source.workspace_id,
      source_id:    source.id,
      event_type:   "checked_unchanged",
      detail:       { http_status: fetched.httpStatus, via: "hash" },
    });
    return { kind: "checked_unchanged", httpStatus: fetched.httpStatus };
  }

  // 3. Change detected — look up brand, upload, insert qb_price_sheets row
  const { data: brand, error: brandErr } = await service
    .from("qb_brands")
    .select("id, name, code")
    .eq("id", source.brand_id)
    .single();
  if (brandErr || !brand) {
    return await recordError(service, source, `Brand not found: ${brandErr?.message ?? "unknown"}`, "brand-lookup");
  }

  const { contentType, fileType } = resolveContentType(fetched.contentType, source.url);
  const storagePath = buildStoragePath({
    brandCode: (brand as BrandRow).code,
    hashHex: newHash,
    fileType,
    now,
  });

  const { error: upErr } = await service.storage
    .from("price-sheets")
    .upload(storagePath, fetched.bytes, {
      contentType,
      upsert: false,
    });
  if (upErr) {
    return await recordError(service, source, `Upload failed: ${upErr.message}`, "upload");
  }

  const fileUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/price-sheets/${storagePath}`;

  const filename = buildAutoFilename({
    brandName: (brand as BrandRow).name,
    sourceLabel: source.label,
    now,
  });

  const fileTypeForDb =
    fileType === "pdf" || fileType === "xlsx" || fileType === "xls" || fileType === "csv"
      ? fileType
      : "pdf"; // fallback — extract-price-sheet will reject if actually unreadable

  const { data: newSheet, error: sheetErr } = await service
    .from("qb_price_sheets")
    .insert({
      workspace_id: source.workspace_id,
      brand_id:     source.brand_id,
      source_id:    source.id,
      filename,
      file_url:     fileUrl,
      file_type:    fileTypeForDb,
      status:       "pending_review",
      notes:        `Auto-detected via ${source.label}. Hash ${newHash.slice(0, 12)}…`,
    })
    .select("id")
    .single();
  if (sheetErr || !newSheet) {
    return await recordError(service, source, `Insert sheet failed: ${sheetErr?.message ?? "unknown"}`, "insert-sheet");
  }

  // 4. Update source with the new hash + clear errors
  await service
    .from("qb_brand_sheet_sources")
    .update({
      last_checked_at:      now.toISOString(),
      last_hash:            newHash,
      last_etag:            fetched.etag ?? null,
      last_http_status:     fetched.httpStatus,
      last_error:           null,
      consecutive_failures: 0,
    })
    .eq("id", source.id);

  await service.from("qb_sheet_watch_events").insert({
    workspace_id:    source.workspace_id,
    source_id:       source.id,
    event_type:      "change_detected",
    price_sheet_id:  newSheet.id,
    detail: {
      old_hash:    source.last_hash,
      new_hash:    newHash,
      http_status: fetched.httpStatus,
      file_url:    fileUrl,
      kind:        change,
    },
  });

  // 5. Fire extract-price-sheet — best-effort. A failure here leaves the
  //    sheet in pending_review so admin can retry from the UI.
  try {
    const resp = await service.functions.invoke("extract-price-sheet", {
      body: { priceSheetId: newSheet.id },
    });
    if (resp.error) {
      await emitAdminFlare(service, {
        source: "qb-price-sheet-watchdog",
        priceSheetId: newSheet.id,
        brandId:  source.brand_id,
        phase:    "extract-trigger",
        message:  `extract-price-sheet invoke returned error: ${resp.error.message}`,
        extra:    { sourceId: source.id },
      });
      // Don't record 'sheet_extracted'; admin can retry. Fall through to
      // change_detected outcome.
    } else {
      await service.from("qb_sheet_watch_events").insert({
        workspace_id:    source.workspace_id,
        source_id:       source.id,
        event_type:      "sheet_extracted",
        price_sheet_id:  newSheet.id,
        detail:          { invoke_data: resp.data ?? null },
      });
      return { kind: "sheet_extracted", priceSheetId: newSheet.id };
    }
  } catch (e) {
    await emitAdminFlare(service, {
      source: "qb-price-sheet-watchdog",
      priceSheetId: newSheet.id,
      brandId:  source.brand_id,
      phase:    "extract-trigger",
      message:  e instanceof Error ? e.message : String(e),
      extra:    { sourceId: source.id },
    });
  }

  return {
    kind: "change_detected",
    priceSheetId: newSheet.id,
    httpStatus: fetched.httpStatus,
    oldHash: source.last_hash,
    newHash,
  };
}

async function recordError(
  service: SupabaseClient,
  source: SourceRow,
  message: string,
  stage: string,
): Promise<CheckOutcome> {
  const now = new Date();
  await service
    .from("qb_brand_sheet_sources")
    .update({
      last_checked_at:      now.toISOString(),
      last_error:           message,
      consecutive_failures: source.consecutive_failures + 1,
    })
    .eq("id", source.id);

  await service.from("qb_sheet_watch_events").insert({
    workspace_id: source.workspace_id,
    source_id:    source.id,
    event_type:   "error",
    detail:       { message, stage },
  });

  await emitAdminFlare(service, {
    source:  "qb-price-sheet-watchdog",
    priceSheetId: null,
    brandId: source.brand_id,
    phase:   "poll",
    message: `[${source.label}] ${stage}: ${message}`,
    extra:   { sourceId: source.id, consecutiveFailures: source.consecutive_failures + 1 },
  });

  return { kind: "error", message, stage };
}
