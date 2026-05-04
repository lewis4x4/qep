/**
 * Audit log API — read-only admin queries across the central
 * record_change_history compatibility view plus the legacy qb_*_audit tables.
 * Surfaces "who changed what, when" without requiring an engineer to open the
 * DB console.
 *
 * Query strategy: parallel SELECTs (one per audit source) merged client-side.
 * Bun's Promise.all handles the fan-out; result is a single sorted array.
 *
 * Actor resolution: profiles are read in a single second round-trip once we
 * know the set of distinct actor_ids in the page. Uses `auth.users` through
 * the `profiles` table — same pattern as other admin pages.
 */

import { supabase } from "@/lib/supabase";

/** All audit tables we unify in the log view. Order is the display/filter order. */
export const AUDIT_TABLES = [
  "v_audit_record_changes",
  "qb_price_sheets_audit",
  "qb_quotes_audit",
  "qb_deals_audit",
  "qb_brands_audit",
  "qb_equipment_models_audit",
  "qb_attachments_audit",
  "qb_programs_audit",
] as const;

export type AuditTable = (typeof AUDIT_TABLES)[number];

/** Friendly label for the UI — strips the `qb_` prefix + `_audit` suffix. */
export function auditTableLabel(t: AuditTable): string {
  if (t === "v_audit_record_changes") return "record changes";
  const stripped = t.replace(/^qb_/, "").replace(/_audit$/, "");
  return stripped.replace(/_/g, " ");
}

export type AuditAction = "insert" | "update" | "delete";

export interface AuditEvent {
  id: string;
  table: AuditTable;
  source_table_name: string | null;
  record_id: string;
  action: AuditAction;
  actor_id: string | null;
  actor_email: string | null;
  changed_fields: Record<string, { old: unknown; new: unknown }> | null;
  snapshot: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditFilter {
  /** How many days back to fetch. null = no cap. Default: 14. */
  daysBack?: number | null;
  /** Specific tables to include. Empty/undefined = all. */
  tables?: AuditTable[];
  /** Specific action to include. Undefined = all. */
  action?: AuditAction | null;
  /** Max events per table before merge. Default: 100. */
  perTableLimit?: number;
}

const DEFAULT_DAYS_BACK = 14;
const DEFAULT_PER_TABLE_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isAuditAction(value: unknown): value is AuditAction {
  return value === "insert" || value === "update" || value === "delete";
}

function isChangeTuple(value: unknown): value is { old: unknown; new: unknown } {
  return isRecord(value) && "old" in value && "new" in value;
}

function isLegacyChangedFields(value: unknown): value is AuditEvent["changed_fields"] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return Object.values(value).every(isChangeTuple);
}

function normalizeChangedFields(value: unknown, action: AuditAction): AuditEvent["changed_fields"] | undefined {
  if (isLegacyChangedFields(value)) return value;
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value);
  if (entries.some(([, fieldValue]) => isRecord(fieldValue) && ("old" in fieldValue || "new" in fieldValue))) {
    return undefined;
  }

  return Object.fromEntries(
    entries.map(([key, fieldValue]) => [
      key,
      action === "delete"
        ? { old: fieldValue, new: null }
        : { old: null, new: fieldValue },
    ]),
  );
}

function snapshotOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function normalizeAuditEvents(table: AuditTable, value: unknown): AuditEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const recordId = requiredString(row.record_id);
    const createdAt = requiredString(row.occurred_at) ?? requiredString(row.created_at);
    if (!id || !recordId || !createdAt || !isAuditAction(row.action)) {
      return [];
    }
    const changedFields = normalizeChangedFields(row.changed_fields, row.action);
    if (changedFields === undefined) return [];
    return [{
      id,
      table,
      source_table_name: nullableString(row.table_name),
      record_id: recordId,
      action: row.action,
      actor_id: nullableString(row.actor_id) ?? nullableString(row.actor_user_id) ?? nullableString(row.created_by),
      actor_email: null,
      changed_fields: changedFields,
      snapshot: snapshotOrNull(row.snapshot) ?? snapshotOrNull(row.after_snapshot) ?? snapshotOrNull(row.before_snapshot),
      created_at: createdAt,
    }];
  });
}

export function normalizeAuditActorProfiles(value: unknown): Array<{ id: string; email: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = requiredString(row.id);
    const email = requiredString(row.email);
    return id && email ? [{ id, email }] : [];
  });
}

function cutoffIso(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

export async function getRecentAuditEvents(
  opts: AuditFilter = {},
): Promise<AuditEvent[]> {
  const daysBack = opts.daysBack === undefined ? DEFAULT_DAYS_BACK : opts.daysBack;
  const cutoff = daysBack != null ? cutoffIso(daysBack) : null;
  const limit = opts.perTableLimit ?? DEFAULT_PER_TABLE_LIMIT;
  const tables: readonly AuditTable[] =
    opts.tables && opts.tables.length > 0 ? opts.tables : AUDIT_TABLES;

  const queries = tables.map(async (t) => {
    const central = t === "v_audit_record_changes";
    let q = central
      ? supabase
          .from(t)
          .select("id, table_name, record_id, actor_user_id, created_by, action, changed_fields, before_snapshot, after_snapshot, occurred_at, created_at")
          .order("occurred_at", { ascending: false })
          .limit(limit)
      : supabase
          .from(t)
          .select("id, record_id, action, actor_id, changed_fields, snapshot, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
    if (cutoff) q = central ? q.gte("occurred_at", cutoff) : q.gte("created_at", cutoff);
    if (opts.action) q = q.eq("action", opts.action);
    const { data, error } = await q;
    if (error) return [];
    return normalizeAuditEvents(t, data);
  });

  const resultsPerTable = await Promise.all(queries);
  const merged: AuditEvent[] = resultsPerTable.flat();
  merged.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Actor email resolution — single query for the distinct actor_ids present
  const actorIds = [...new Set(merged.map((e) => e.actor_id).filter((x): x is string => !!x))];
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", actorIds);
    const byId = new Map<string, string>();
    for (const p of normalizeAuditActorProfiles(profiles)) {
      byId.set(p.id, p.email);
    }
    for (const e of merged) {
      if (e.actor_id && byId.has(e.actor_id)) {
        e.actor_email = byId.get(e.actor_id) ?? null;
      }
    }
  }

  return merged;
}

/**
 * Count of events per table for the given filter window. Drives the
 * filter chip badges on the UI.
 */
export async function getAuditCountsByTable(
  opts: AuditFilter = {},
): Promise<Record<AuditTable, number>> {
  const daysBack = opts.daysBack === undefined ? DEFAULT_DAYS_BACK : opts.daysBack;
  const cutoff = daysBack != null ? cutoffIso(daysBack) : null;
  const queries = AUDIT_TABLES.map(async (t) => {
    const central = t === "v_audit_record_changes";
    let q = supabase
      .from(t)
      .select("id", { count: "exact", head: true });
    if (cutoff) q = central ? q.gte("occurred_at", cutoff) : q.gte("created_at", cutoff);
    if (opts.action) q = q.eq("action", opts.action);
    const { count } = await q;
    return [t, count ?? 0] as const;
  });
  const pairs = await Promise.all(queries);
  const result = {} as Record<AuditTable, number>;
  for (const [t, c] of pairs) result[t] = c;
  return result;
}

/**
 * Short description of a change for the log row. Picks the most useful
 * fields from `snapshot` to identify the record (e.g., brand name, zone
 * name). Pure — exported for testing.
 */
export function summarizeRecord(e: AuditEvent): string {
  const snap = e.snapshot ?? {};
  // Pick first present "display field" in order of usefulness per table
  const candidates = [
    "name", "zone_name", "filename", "quote_number", "model_code",
    "part_number", "program_code", "code",
  ];
  for (const key of candidates) {
    const v = (snap as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return e.record_id.slice(0, 8) + "…";
}
