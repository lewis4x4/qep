/**
 * Audit log API — read-only admin queries across the 7 qb_*_audit tables
 * (migration 288). Surfaces "who changed what, when" without requiring an
 * engineer to open the DB console.
 *
 * Query strategy: 7 parallel SELECTs (one per audit table) merged client-side.
 * Bun's Promise.all handles the fan-out; result is a single sorted array.
 *
 * Actor resolution: profiles are read in a single second round-trip once we
 * know the set of distinct actor_ids in the page. Uses `auth.users` through
 * the `profiles` table — same pattern as other admin pages.
 */

import { supabase } from "@/lib/supabase";

/** All audit tables we unify in the log view. Order is the display/filter order. */
export const AUDIT_TABLES = [
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
  const stripped = t.replace(/^qb_/, "").replace(/_audit$/, "");
  return stripped.replace(/_/g, " ");
}

export type AuditAction = "insert" | "update" | "delete";

export interface AuditEvent {
  id: string;
  table: AuditTable;
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
    let q = supabase
      .from(t)
      .select("id, record_id, action, actor_id, changed_fields, snapshot, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (cutoff) q = q.gte("created_at", cutoff);
    if (opts.action) q = q.eq("action", opts.action);
    const { data, error } = await q;
    if (error) return [] as AuditEvent[];
    return ((data ?? []) as Array<{
      id: string;
      record_id: string;
      action: string;
      actor_id: string | null;
      changed_fields: Record<string, { old: unknown; new: unknown }> | null;
      snapshot: Record<string, unknown> | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      table: t,
      record_id: row.record_id,
      action: row.action as AuditAction,
      actor_id: row.actor_id,
      actor_email: null, // filled in by the actor-resolution round-trip below
      changed_fields: row.changed_fields,
      snapshot: row.snapshot,
      created_at: row.created_at,
    }));
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
    for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) {
      if (p.email) byId.set(p.id, p.email);
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
    let q = supabase
      .from(t)
      .select("id", { count: "exact", head: true });
    if (cutoff) q = q.gte("created_at", cutoff);
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
