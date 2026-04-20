/**
 * Signals data-access — the normalized event stream.
 *
 * A "signal" is anything the system notices that might warrant an operator
 * move: an inbound email, a telematics fault, a news mention, an SLA breach.
 * Signals are the upstream feed for the deterministic recommender, which
 * turns them into moves on the Today surface.
 *
 * Contract:
 *   ingestSignal(ctx, payload) — idempotent insert keyed on dedupe_key
 *   listSignals(ctx, filters)   — GET /qrm/signals (Pulse surface)
 *   parseSignalListFilters()    — shared querystring parser
 *
 * Dedup:
 *   Each signal may include a dedupe_key. The migration 310 schema enforces
 *   a partial unique index on (workspace_id, dedupe_key) WHERE dedupe_key
 *   IS NOT NULL, so re-ingesting the same key is a no-op. Ingesters are
 *   expected to construct a stable key per external event id. If no key is
 *   provided we fall through to a blind insert.
 */

import type { RouterCtx } from "./crm-router-service.ts";

export type SignalKind =
  | "stage_change"
  | "sla_breach"
  | "sla_warning"
  | "quote_viewed"
  | "quote_expiring"
  | "deposit_received"
  | "credit_approved"
  | "credit_declined"
  | "inbound_email"
  | "inbound_call"
  | "inbound_sms"
  | "telematics_idle"
  | "telematics_fault"
  | "permit_filed"
  | "auction_listing"
  | "competitor_mention"
  | "news_mention"
  | "equipment_available"
  | "equipment_returning"
  | "service_due"
  | "warranty_expiring"
  | "other";

export type SignalSeverity = "low" | "medium" | "high" | "critical";

export type SignalEntityType =
  | "deal"
  | "contact"
  | "company"
  | "equipment"
  | "activity"
  | "rental"
  | "workspace";

const ALL_KINDS: Set<SignalKind> = new Set<SignalKind>([
  "stage_change",
  "sla_breach",
  "sla_warning",
  "quote_viewed",
  "quote_expiring",
  "deposit_received",
  "credit_approved",
  "credit_declined",
  "inbound_email",
  "inbound_call",
  "inbound_sms",
  "telematics_idle",
  "telematics_fault",
  "permit_filed",
  "auction_listing",
  "competitor_mention",
  "news_mention",
  "equipment_available",
  "equipment_returning",
  "service_due",
  "warranty_expiring",
  "other",
]);

const ALL_SEVERITIES: Set<SignalSeverity> = new Set<SignalSeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);

const ALL_ENTITY_TYPES: Set<SignalEntityType> = new Set<SignalEntityType>([
  "deal",
  "contact",
  "company",
  "equipment",
  "activity",
  "rental",
  "workspace",
]);

export interface SignalRow {
  id: string;
  workspace_id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  source: string;
  title: string;
  description: string | null;
  entity_type: SignalEntityType | null;
  entity_id: string | null;
  assigned_rep_id: string | null;
  dedupe_key: string | null;
  occurred_at: string;
  suppressed_until: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SignalIngestPayload {
  kind: SignalKind;
  severity?: SignalSeverity;
  /** Human-recognizable origin tag, e.g. "gmail", "tavily", "telematics". */
  source: string;
  title: string;
  description?: string | null;
  entityType?: SignalEntityType | null;
  entityId?: string | null;
  assignedRepId?: string | null;
  /**
   * Stable per-event key — ingesters MUST construct one if the upstream has
   * a notion of event id, so re-deliveries are idempotent.
   */
  dedupeKey?: string | null;
  occurredAt?: string | null;
  suppressedUntil?: string | null;
  payload?: Record<string, unknown>;
  /**
   * Optional workspace override. If omitted, we fall back to the router
   * context's workspace. Service-role bulk ingesters (e.g. the news scan)
   * loop across workspaces and will pass this explicitly.
   */
  workspaceId?: string;
}

export interface SignalListFilters {
  kinds: SignalKind[];
  severityAtLeast: SignalSeverity | null;
  entityType: SignalEntityType | null;
  entityId: string | null;
  assignedRepId: string | null;
  /** ISO timestamp; only signals occurring on or after this are returned. */
  since: string | null;
  limit: number;
}

const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function validateSignalPayload(body: SignalIngestPayload): void {
  if (!body.kind || !ALL_KINDS.has(body.kind)) {
    throw new Error("VALIDATION_ERROR:kind");
  }
  if (!body.source || typeof body.source !== "string" || body.source.length === 0) {
    throw new Error("VALIDATION_ERROR:source");
  }
  if (!body.title || typeof body.title !== "string" || body.title.length === 0) {
    throw new Error("VALIDATION_ERROR:title");
  }
  if (body.severity && !ALL_SEVERITIES.has(body.severity)) {
    throw new Error("VALIDATION_ERROR:severity");
  }
  if (body.entityType && !ALL_ENTITY_TYPES.has(body.entityType)) {
    throw new Error("VALIDATION_ERROR:entityType");
  }
  if (body.occurredAt && Number.isNaN(new Date(body.occurredAt).getTime())) {
    throw new Error("VALIDATION_ERROR:occurredAt");
  }
  if (body.suppressedUntil && Number.isNaN(new Date(body.suppressedUntil).getTime())) {
    throw new Error("VALIDATION_ERROR:suppressedUntil");
  }
}

export function parseSignalListFilters(params: URLSearchParams): SignalListFilters {
  const kindParam = params.get("kind");
  const kinds = kindParam
    ? kindParam
        .split(",")
        .map((raw) => raw.trim())
        .filter((raw): raw is SignalKind => ALL_KINDS.has(raw as SignalKind))
    : [];

  const severityRaw = params.get("severity_at_least");
  const severityAtLeast =
    severityRaw && ALL_SEVERITIES.has(severityRaw as SignalSeverity)
      ? (severityRaw as SignalSeverity)
      : null;

  const entityTypeRaw = params.get("entity_type");
  const entityType =
    entityTypeRaw && ALL_ENTITY_TYPES.has(entityTypeRaw as SignalEntityType)
      ? (entityTypeRaw as SignalEntityType)
      : null;

  const entityId = params.get("entity_id");
  const assignedRepId = params.get("assigned_rep_id");
  const since = params.get("since");

  const limitRaw = Number.parseInt(params.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  return {
    kinds,
    severityAtLeast,
    entityType,
    entityId: entityId && entityId.length > 0 ? entityId : null,
    assignedRepId: assignedRepId && assignedRepId.length > 0 ? assignedRepId : null,
    since: since && !Number.isNaN(new Date(since).getTime()) ? since : null,
    limit,
  };
}

export interface SignalIngestResult {
  row: SignalRow;
  /**
   * True when the signal already existed under the provided dedupe_key and
   * we returned the pre-existing row instead of inserting a new one.
   * Callers that want to track cron dedup rates (e.g. news-mention-scan)
   * should use `ingestSignalDetailed` and read this flag rather than
   * pre-checking the table themselves.
   */
  deduped: boolean;
}

/**
 * Upsert-by-dedupe_key semantics. If a dedupe_key is provided and a row
 * already exists for (workspace_id, dedupe_key), we return the existing
 * row; otherwise we insert fresh. This means webhook re-deliveries and
 * cron re-scans never duplicate.
 *
 * Returns only the row — use `ingestSignalDetailed` if the caller needs to
 * know whether the row was brand-new or a dedup hit.
 */
export async function ingestSignal(
  ctx: RouterCtx,
  body: SignalIngestPayload,
): Promise<SignalRow> {
  const { row } = await ingestSignalDetailed(ctx, body);
  return row;
}

/**
 * Same ingest semantics as `ingestSignal` but also reports whether the row
 * came from the dedup fast path (pre-existing) or a fresh insert. Bulk
 * scanners use this to keep accurate created-vs-deduped counters without a
 * redundant pre-check.
 */
export async function ingestSignalDetailed(
  ctx: RouterCtx,
  body: SignalIngestPayload,
): Promise<SignalIngestResult> {
  validateSignalPayload(body);

  const workspaceId = body.workspaceId ?? ctx.workspaceId;

  // Fast-path dedup: look up first, return existing if found.
  if (body.dedupeKey) {
    const { data: existing } = await ctx.admin
      .from("signals")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("dedupe_key", body.dedupeKey)
      .maybeSingle();

    if (existing) {
      return { row: existing as SignalRow, deduped: true };
    }
  }

  const row = {
    workspace_id: workspaceId,
    kind: body.kind,
    severity: body.severity ?? "medium",
    source: body.source,
    title: body.title,
    description: body.description ?? null,
    entity_type: body.entityType ?? null,
    entity_id: body.entityId ?? null,
    assigned_rep_id: body.assignedRepId ?? null,
    dedupe_key: body.dedupeKey ?? null,
    occurred_at: body.occurredAt ?? new Date().toISOString(),
    suppressed_until: body.suppressedUntil ?? null,
    payload: body.payload ?? {},
  };

  const { data, error } = await ctx.admin
    .from("signals")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    // If a race caused a unique-constraint violation on dedupe_key, fall
    // back to the existing row so the caller still gets a usable response.
    // PostgreSQL SQLSTATE 23505 = unique_violation. We match on the code so
    // localized / reworded error text never breaks this path — and because
    // the rest of the repo uses the same check (see _shared/portal-customer-
    // notify.ts, _shared/parts-fulfillment-mirror.ts, _shared/flow-bus/
    // publish.ts). This replaces a fragile substring match on
    // "duplicate"/"unique" in error.message.
    const code = (error as { code?: string }).code ?? "";
    if (body.dedupeKey && code === "23505") {
      const { data: raced } = await ctx.admin
        .from("signals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("dedupe_key", body.dedupeKey)
        .maybeSingle();
      if (raced) return { row: raced as SignalRow, deduped: true };
    }
    throw error;
  }

  return { row: data as SignalRow, deduped: false };
}

/**
 * Fetch a fixed set of signals by id, workspace-scoped.
 *
 * Backs the "Triggered by" panel on a MoveCard — given a move's
 * `signal_ids: uuid[]` array, the UI fetches the referenced signals lazily
 * when the panel is expanded. RLS still applies on top of the workspace
 * check, so a rep only sees signals they're authorised for.
 *
 * Returns up to 20 signals; we truncate defensively because a pathological
 * move could in principle reference many signal ids.
 */
export async function listSignalsByIds(
  ctx: RouterCtx,
  ids: readonly string[],
): Promise<SignalRow[]> {
  const capped = ids.filter((id) => typeof id === "string" && id.length > 0).slice(0, 20);
  if (capped.length === 0) return [];

  const { data, error } = await ctx.callerDb
    .from("signals")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .in("id", capped)
    .order("occurred_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SignalRow[];
}

export async function listSignals(
  ctx: RouterCtx,
  filters: SignalListFilters,
): Promise<SignalRow[]> {
  let query = ctx.callerDb
    .from("signals")
    .select("*")
    .eq("workspace_id", ctx.workspaceId);

  if (filters.kinds.length > 0) {
    query = query.in("kind", filters.kinds);
  }

  if (filters.severityAtLeast) {
    const floor = SEVERITY_ORDER[filters.severityAtLeast];
    const allowed = (Object.entries(SEVERITY_ORDER) as [SignalSeverity, number][])
      .filter(([, idx]) => idx >= floor)
      .map(([key]) => key);
    query = query.in("severity", allowed);
  }

  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.assignedRepId) query = query.eq("assigned_rep_id", filters.assignedRepId);
  if (filters.since) query = query.gte("occurred_at", filters.since);

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(filters.limit);

  if (error) throw error;
  return (data ?? []) as SignalRow[];
}
