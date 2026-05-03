/**
 * Sheet Watchdog API — Slice 16.
 *
 * Service layer for qb_brand_sheet_sources + qb_sheet_watch_events. The
 * watchdog itself (polling + hash-compare + extract trigger) runs as an
 * edge function; this module is the admin-UI side — CRUD for sources,
 * event-log queries for the health strip, and a "trigger check now"
 * RPC-style wrapper so Angela can smoke-test a new source without
 * waiting for the scheduler.
 *
 * Design notes:
 *  - `listSources` joins to qb_brands so the list UI can group by brand
 *    without a second query.
 *  - `getSourceHealth` is a pure aggregation over recent events; 20-event
 *    window is enough for the admin strip to show "4 successful checks,
 *    1 error in the last week" without pulling the whole log.
 *  - `triggerManualCheck` invokes the edge function with a single
 *    sourceId — that function's happy path writes the manual_trigger
 *    event row itself, so this wrapper just returns the pass-through.
 */

import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

// ── Types ────────────────────────────────────────────────────────────────

export type SheetSourceRow =
  Database["public"]["Tables"]["qb_brand_sheet_sources"]["Row"];
export type SheetSourceInsert =
  Database["public"]["Tables"]["qb_brand_sheet_sources"]["Insert"];
export type SheetSourceUpdate =
  Database["public"]["Tables"]["qb_brand_sheet_sources"]["Update"];
export type SheetWatchEventRow =
  Database["public"]["Tables"]["qb_sheet_watch_events"]["Row"];

export type SheetEventType = SheetWatchEventRow["event_type"];

/** Joined row as returned by listSources — qb_brands embed is flattened for easy render. */
export interface SheetSourceWithBrand extends SheetSourceRow {
  brand_name: string | null;
  brand_code: string | null;
}

/** Lightweight health digest over the recent event stream. */
export interface SourceHealth {
  sourceId: string;
  /** Sum of event types from the last N events (default 20). */
  counts: Record<SheetEventType, number>;
  /** true when last event was 'error' or consecutive_failures >= 3. */
  isUnhealthy: boolean;
  /** ISO timestamp of the most recent check (any event type). */
  lastEventAt: string | null;
  /** Last successful (non-error) event at. Used to compute "silent since" windows. */
  lastSuccessAt: string | null;
}

export interface SheetWatchBrandOption {
  id: string;
  name: string;
  code: string;
}

const SHEET_EVENT_TYPES = [
  "checked_unchanged",
  "change_detected",
  "sheet_extracted",
  "error",
  "manual_trigger",
] as const satisfies readonly SheetEventType[];
const SHEET_EVENT_TYPE_SET: ReadonlySet<string> = new Set(SHEET_EVENT_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function isSheetEventType(value: unknown): value is SheetEventType {
  return typeof value === "string" && SHEET_EVENT_TYPE_SET.has(value);
}

function isJsonValue(value: unknown): value is NonNullable<SheetWatchEventRow["detail"]> {
  if (value === null) return false;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every((item) => item === null || isJsonValue(item));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => item === null || isJsonValue(item));
}

function normalizeBrandJoin(value: unknown): { brand_name: string | null; brand_code: string | null } {
  const brand = Array.isArray(value) ? value.find(isRecord) : value;
  if (!isRecord(brand)) return { brand_name: null, brand_code: null };
  return {
    brand_name: stringOrNull(brand.name),
    brand_code: stringOrNull(brand.code),
  };
}

export function normalizeSheetSourceRows(value: unknown): SheetSourceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const workspaceId = requiredString(row.workspace_id);
    const brandId = requiredString(row.brand_id);
    const label = requiredString(row.label);
    const createdAt = requiredString(row.created_at);
    const updatedAt = requiredString(row.updated_at);
    if (!id || !workspaceId || !brandId || !label || !createdAt || !updatedAt) return [];
    return [{
      id,
      workspace_id: workspaceId,
      brand_id: brandId,
      label,
      url: stringOrNull(row.url),
      check_freq_hours: numberOrZero(row.check_freq_hours),
      last_checked_at: stringOrNull(row.last_checked_at),
      last_hash: stringOrNull(row.last_hash),
      last_etag: stringOrNull(row.last_etag),
      last_http_status: numberOrNull(row.last_http_status),
      last_error: stringOrNull(row.last_error),
      consecutive_failures: numberOrZero(row.consecutive_failures),
      notes: stringOrNull(row.notes),
      active: row.active === true,
      created_by: stringOrNull(row.created_by),
      created_at: createdAt,
      updated_at: updatedAt,
    }];
  });
}

export function normalizeSheetSourceWithBrandRows(value: unknown): SheetSourceWithBrand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const [source] = normalizeSheetSourceRows([row]);
    if (!source || !isRecord(row)) return [];
    return [{
      ...source,
      ...normalizeBrandJoin(row.qb_brands),
    }];
  });
}

export function normalizeSheetWatchEventRows(value: unknown): SheetWatchEventRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const workspaceId = requiredString(row.workspace_id);
    const sourceId = requiredString(row.source_id);
    const createdAt = requiredString(row.created_at);
    if (!id || !workspaceId || !sourceId || !createdAt || !isSheetEventType(row.event_type)) return [];
    return [{
      id,
      workspace_id: workspaceId,
      source_id: sourceId,
      event_type: row.event_type,
      detail: isJsonValue(row.detail) ? row.detail : null,
      price_sheet_id: stringOrNull(row.price_sheet_id),
      created_at: createdAt,
    }];
  });
}

export function normalizeSheetWatchBrandOptions(value: unknown): SheetWatchBrandOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const name = requiredString(row.name);
    const code = requiredString(row.code);
    return id && name && code ? [{ id, name, code }] : [];
  });
}

// ── Sources CRUD ─────────────────────────────────────────────────────────

/**
 * Returns all sources joined to their brand for the admin list. Orders by
 * brand name then source label for stable grouping.
 */
export async function listSources(): Promise<SheetSourceWithBrand[]> {
  const { data, error } = await supabase
    .from("qb_brand_sheet_sources")
    .select("*, qb_brands!brand_id(id, name, code)")
    .order("brand_id", { ascending: true })
    .order("label", { ascending: true });
  if (error || !data) return [];
  return normalizeSheetSourceWithBrandRows(data);
}

export async function getSource(id: string): Promise<SheetSourceRow | null> {
  const { data } = await supabase
    .from("qb_brand_sheet_sources")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return normalizeSheetSourceRows(data ? [data] : [])[0] ?? null;
}

export async function upsertSource(input: {
  id?: string;
  workspaceId: string;
  brandId: string;
  label: string;
  url: string | null;
  checkFreqHours: number;
  notes?: string | null;
  active?: boolean;
  createdBy?: string | null;
}): Promise<{ ok: true; row: SheetSourceRow } | { error: string }> {
  if (!input.brandId) return { error: "Brand is required" };
  if (!input.label.trim()) return { error: "Label is required" };
  if (input.checkFreqHours < 1 || input.checkFreqHours > 720) {
    return { error: "Check frequency must be between 1 and 720 hours" };
  }
  if (input.url != null && input.url.trim().length > 0) {
    try {
      const parsed = new URL(input.url.trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { error: "URL must be http(s)" };
      }
    } catch {
      return { error: "URL is not a valid URL" };
    }
  }

  const payload: SheetSourceInsert = {
    id:               input.id,
    workspace_id:     input.workspaceId,
    brand_id:         input.brandId,
    label:            input.label.trim(),
    url:              input.url?.trim() ?? null,
    check_freq_hours: input.checkFreqHours,
    notes:            input.notes?.trim() || null,
    active:           input.active ?? true,
    created_by:       input.createdBy ?? null,
  };

  const { data, error } = await supabase
    .from("qb_brand_sheet_sources")
    .upsert(payload, { onConflict: input.id ? "id" : undefined })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed to save source" };
  const row = normalizeSheetSourceRows([data])[0];
  if (!row) return { error: "Saved source returned malformed row" };
  return { ok: true, row };
}

export async function deleteSource(id: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase.from("qb_brand_sheet_sources").delete().eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function setSourceActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabase
    .from("qb_brand_sheet_sources")
    .update({ active } satisfies SheetSourceUpdate)
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ── Events & health ──────────────────────────────────────────────────────

export async function listRecentEvents(
  sourceId: string,
  limit = 20,
): Promise<SheetWatchEventRow[]> {
  const { data } = await supabase
    .from("qb_sheet_watch_events")
    .select("*")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return normalizeSheetWatchEventRows(data);
}

export async function listRecentEventsForWorkspace(
  limit = 50,
): Promise<SheetWatchEventRow[]> {
  const { data } = await supabase
    .from("qb_sheet_watch_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return normalizeSheetWatchEventRows(data);
}

/**
 * Pure aggregation — exported for tests. Feed the most recent N events
 * (caller chooses the window) and the current source row; get back a
 * health digest suitable for the sources admin list.
 */
export function summarizeSourceHealth(
  source: Pick<SheetSourceRow, "id" | "consecutive_failures">,
  events: SheetWatchEventRow[],
): SourceHealth {
  const counts: Record<SheetEventType, number> = {
    checked_unchanged: 0,
    change_detected: 0,
    sheet_extracted: 0,
    error: 0,
    manual_trigger: 0,
  };

  let lastEventAt: string | null = null;
  let lastSuccessAt: string | null = null;

  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
    if (!lastEventAt || e.created_at > lastEventAt) lastEventAt = e.created_at;
    if (e.event_type !== "error") {
      if (!lastSuccessAt || e.created_at > lastSuccessAt) lastSuccessAt = e.created_at;
    }
  }

  const lastEvent = events[0]; // events are ordered DESC by created_at
  const isUnhealthy =
    source.consecutive_failures >= 3 ||
    (lastEvent?.event_type === "error");

  return {
    sourceId: source.id,
    counts,
    isUnhealthy,
    lastEventAt,
    lastSuccessAt,
  };
}

// ── Manual check trigger ─────────────────────────────────────────────────

/**
 * Kicks the watchdog edge function for a single source. The function
 * logs its own manual_trigger + result events, so this just needs to
 * return the pass-through status.
 */
export async function triggerManualCheck(
  sourceId: string,
): Promise<{ ok: true; result: unknown } | { error: string }> {
  const { data, error } = await supabase.functions.invoke("qb-price-sheet-watchdog", {
    body: { sourceId, manualTrigger: true },
  });
  if (error) return { error: error.message ?? "Invoke failed" };
  return { ok: true, result: data };
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Compute the hash-comparison result. Exported separately so both the
 * edge function and client tests can verify identical semantics.
 */
export function detectHashChange(
  prevHash: string | null | undefined,
  nextHash: string,
): "first_seen" | "unchanged" | "changed" {
  if (!prevHash) return "first_seen";
  if (prevHash === nextHash) return "unchanged";
  return "changed";
}

/**
 * Format "Checked N minutes ago" label for the admin list. Pure.
 */
export function formatLastChecked(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "Never checked";
  const then = new Date(iso).getTime();
  const deltaMs = now.getTime() - then;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "Checked just now";
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return "Checked just now";
  if (mins < 60) return `Checked ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days}d ago`;
}

/**
 * Returns true when the source is overdue relative to its configured
 * check cadence. Pure — used for UI badges and by the watchdog cron to
 * pick sources to poll in batch.
 */
export function isOverdue(
  source: Pick<SheetSourceRow, "active" | "last_checked_at" | "check_freq_hours">,
  now = new Date(),
): boolean {
  if (!source.active) return false;
  if (!source.last_checked_at) return true;
  const last = new Date(source.last_checked_at).getTime();
  const dueAt = last + source.check_freq_hours * 60 * 60 * 1000;
  return now.getTime() >= dueAt;
}
