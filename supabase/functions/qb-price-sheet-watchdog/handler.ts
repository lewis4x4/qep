/**
 * qb-price-sheet-watchdog handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace cannot retarget batch or single-source loads.
 *
 * Service role: unscoped batch when no workspace hint, or optional
 * x-workspace-id / body.workspace to narrow one shop.
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

export type SourceRow = {
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

export type CheckOutcome =
  | { kind: "checked_unchanged"; httpStatus: number }
  | { kind: "change_detected"; priceSheetId: string; httpStatus: number; oldHash: string | null; newHash: string }
  | { kind: "sheet_extracted"; priceSheetId: string }
  | { kind: "error"; message: string; stage: string };

export type RequestBody = {
  sourceId?: string;
  manualTrigger?: boolean;
  batch?: boolean;
  workspace?: string | null;
};

export type WorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type WatchdogAuthResult =
  | { ok: false; status: 401 | 403; message: string }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveWatchdogWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): WorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.headerWorkspaceId);
    if (explicit) {
      return { mode: "scoped", workspaceId: explicit };
    }
    return { mode: "unscoped" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  if (!workspaceId) {
    return { mode: "scoped", workspaceId: "" };
  }
  return { mode: "scoped", workspaceId };
}

export function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: WorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

export async function authenticateWatchdog(
  req: Request,
  origin: string | null,
): Promise<WatchdogAuthResult> {
  if (isServiceRoleCaller(req)) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: normalizeWorkspaceId(req.headers.get("x-workspace-id")),
    };
  }

  const auth = await requireServiceUser(req.headers.get("authorization"), origin);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.response.status === 403 ? 403 : 401,
      message: "Unauthorized",
    };
  }

  if (!["admin", "manager", "owner"].includes(auth.role)) {
    return {
      ok: false,
      status: 403,
      message: "Watchdog requires admin, manager, or owner role",
    };
  }

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", auth.userId)
    .single();

  const workspaceId = normalizeWorkspaceId(profile?.active_workspace_id);
  if (!workspaceId) {
    return { ok: false, status: 403, message: "Forbidden" };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: auth.userId,
    role: auth.role,
    workspaceId,
  };
}

export interface WatchdogDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    origin: string | null,
  ) => Promise<WatchdogAuthResult>;
  processSource: (
    service: SupabaseClient,
    source: SourceRow,
  ) => Promise<CheckOutcome>;
}

function defaultCreateAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceKey);
}

const defaultDependencies: WatchdogDependencies = {
  createAdminClient: defaultCreateAdminClient,
  authenticate: authenticateWatchdog,
  processSource,
};

export async function handleWatchdogRequest(
  req: Request,
  overrides: Partial<WatchdogDependencies> = {},
): Promise<Response> {
  const { createAdminClient, authenticate, processSource: processSourceImpl } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const auth = await authenticate(req, origin);
  if (!auth.ok) {
    return safeJsonError(auth.message, auth.status, origin);
  }

  const parsed = await parseJsonBody(req, origin);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as RequestBody;

  const workspaceScope = auth.isServiceRole
    ? resolveWatchdogWorkspace({
      isServiceRole: true,
      requestedWorkspaceId: body.workspace ?? null,
      headerWorkspaceId: auth.headerWorkspaceId,
    })
    : resolveWatchdogWorkspace({
      isServiceRole: false,
      authWorkspaceId: auth.workspaceId,
      requestedWorkspaceId: body.workspace ?? null,
    });

  if (!auth.isServiceRole && workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
    return safeJsonError("Forbidden", 403, origin);
  }

  const service = createAdminClient();
  const loadResult = await loadSourcesToProcess(service, body, auth, workspaceScope, origin);
  if ("response" in loadResult) return loadResult.response;
  const sources = loadResult.sources;

  if (sources.length === 0) {
    return safeJsonOk({ ok: true, message: "No sources due for check", processed: 0 }, origin);
  }

  const PER_SOURCE_BUDGET_MS = 20_000;
  const results: Array<{ sourceId: string; outcome: CheckOutcome }> = [];
  const userIdForAudit = auth.isServiceRole ? null : auth.userId;

  for (const source of sources) {
    if (body.manualTrigger && body.sourceId === source.id && userIdForAudit) {
      await service.from("qb_sheet_watch_events").insert({
        workspace_id: source.workspace_id,
        source_id: source.id,
        event_type: "manual_trigger",
        detail: { triggered_by_user: userIdForAudit },
      });
    }

    const outcome = await withTimeout(
      processSourceImpl(service, source),
      PER_SOURCE_BUDGET_MS,
      async () => await recordError(service, source, "Source processing exceeded 20s budget", "timeout"),
    );
    results.push({ sourceId: source.id, outcome });
  }

  return safeJsonOk({ ok: true, processed: results.length, results }, origin);
}

async function loadSourcesToProcess(
  service: SupabaseClient,
  body: RequestBody,
  auth: Extract<WatchdogAuthResult, { ok: true }>,
  workspaceScope: WorkspaceScope,
  origin: string | null,
): Promise<{ sources: SourceRow[] } | { response: Response }> {
  if (body.sourceId) {
    const { data, error } = await service
      .from("qb_brand_sheet_sources")
      .select("*")
      .eq("id", body.sourceId)
      .maybeSingle();
    if (error) {
      console.error("[qb-price-sheet-watchdog] load source failed:", error);
      return { response: safeJsonError("Load source failed", 500, origin) };
    }
    if (!data) return { response: safeJsonError("Source not found", 404, origin) };

    if (!auth.isServiceRole && data.workspace_id !== auth.workspaceId) {
      return { response: safeJsonError("Source not found", 404, origin) };
    }

    return { sources: [data as SourceRow] };
  }

  let query = service
    .from("qb_brand_sheet_sources")
    .select("*")
    .eq("active", true);

  if (!auth.isServiceRole) {
    query = query.eq("workspace_id", auth.workspaceId);
  } else {
    query = applyWorkspaceFilter(query, workspaceScope);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[qb-price-sheet-watchdog] load sources failed:", error);
    return { response: safeJsonError("Load sources failed", 500, origin) };
  }

  const now = new Date();
  const sources = (data as SourceRow[] ?? []).filter((s) => isOverdue(s, now));
  return { sources };
}

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

async function processSource(
  service: SupabaseClient,
  source: SourceRow,
): Promise<CheckOutcome> {
  const now = new Date();

  if (!source.url) {
    return await recordError(service, source, "Source has no URL configured", "config");
  }

  let fetched;
  try {
    fetched = await fetchWithCache(source.url, source.last_etag);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return await recordError(service, source, message, "fetch");
  }

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
      source_id: source.id,
      event_type: "checked_unchanged",
      detail: { http_status: 304, via: "etag" },
    });
    return { kind: "checked_unchanged", httpStatus: 304 };
  }

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
      source_id: source.id,
      event_type: "checked_unchanged",
      detail: { http_status: fetched.httpStatus, via: "hash" },
    });
    return { kind: "checked_unchanged", httpStatus: fetched.httpStatus };
  }

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
      : "pdf";

  const { data: newSheet, error: sheetErr } = await service
    .from("qb_price_sheets")
    .insert({
      workspace_id: source.workspace_id,
      brand_id: source.brand_id,
      source_id: source.id,
      filename,
      file_url: fileUrl,
      file_type: fileTypeForDb,
      status: "pending_review",
      notes: `Auto-detected via ${source.label}. Hash ${newHash.slice(0, 12)}…`,
    })
    .select("id")
    .single();
  if (sheetErr || !newSheet) {
    return await recordError(service, source, `Insert sheet failed: ${sheetErr?.message ?? "unknown"}`, "insert-sheet");
  }

  await service
    .from("qb_brand_sheet_sources")
    .update({
      last_checked_at: now.toISOString(),
      last_hash: newHash,
      last_etag: fetched.etag ?? null,
      last_http_status: fetched.httpStatus,
      last_error: null,
      consecutive_failures: 0,
    })
    .eq("id", source.id);

  await service.from("qb_sheet_watch_events").insert({
    workspace_id: source.workspace_id,
    source_id: source.id,
    event_type: "change_detected",
    price_sheet_id: newSheet.id,
    detail: {
      old_hash: source.last_hash,
      new_hash: newHash,
      http_status: fetched.httpStatus,
      file_url: fileUrl,
      kind: change,
    },
  });

  try {
    const resp = await service.functions.invoke("extract-price-sheet", {
      body: { priceSheetId: newSheet.id },
    });
    if (resp.error) {
      await emitAdminFlare(service, {
        source: "qb-price-sheet-watchdog",
        priceSheetId: newSheet.id,
        brandId: source.brand_id,
        phase: "extract-trigger",
        message: `extract-price-sheet invoke returned error: ${resp.error.message}`,
        extra: { sourceId: source.id },
      });
    } else {
      await service.from("qb_sheet_watch_events").insert({
        workspace_id: source.workspace_id,
        source_id: source.id,
        event_type: "sheet_extracted",
        price_sheet_id: newSheet.id,
        detail: { invoke_data: resp.data ?? null },
      });
      return { kind: "sheet_extracted", priceSheetId: newSheet.id };
    }
  } catch (e) {
    await emitAdminFlare(service, {
      source: "qb-price-sheet-watchdog",
      priceSheetId: newSheet.id,
      brandId: source.brand_id,
      phase: "extract-trigger",
      message: e instanceof Error ? e.message : String(e),
      extra: { sourceId: source.id },
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
      last_checked_at: now.toISOString(),
      last_error: message,
      consecutive_failures: source.consecutive_failures + 1,
    })
    .eq("id", source.id);

  await service.from("qb_sheet_watch_events").insert({
    workspace_id: source.workspace_id,
    source_id: source.id,
    event_type: "error",
    detail: { message, stage },
  });

  await emitAdminFlare(service, {
    source: "qb-price-sheet-watchdog",
    priceSheetId: null,
    brandId: source.brand_id,
    phase: "poll",
    message: `[${source.label}] ${stage}: ${message}`,
    extra: { sourceId: source.id, consecutiveFailures: source.consecutive_failures + 1 },
  });

  return { kind: "error", message, stage };
}
