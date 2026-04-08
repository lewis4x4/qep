/**
 * QRM Flow Bus — subscribe helpers (Phase 0 P0.4).
 *
 * Day 6 ships TWO things:
 *
 *   1. registerSubscription() — write a row to flow_subscriptions
 *      registering a (pattern, handler_module, handler_name) tuple. Passive
 *      metadata in Day 6; Day 7+ wires actual handler dispatch.
 *
 *   2. matchesPattern() — pure function implementing the bus's glob pattern
 *      grammar. Used by the future dispatcher to match arriving event_types
 *      against registered subscription patterns. Tested independently.
 *
 * Pattern grammar:
 *   - Literal: 'follow_up.due' matches exactly 'follow_up.due'
 *   - Universal: '*' matches everything
 *   - Single-segment glob: 'deal.*' matches 'deal.stalled', 'deal.closed_won',
 *     'deal.X' for any X — but NOT 'follow_up.due' or 'deal.stalled.foo'
 *   - Multi-segment glob: '**' matches everything (use sparingly; usually '*' suffices)
 *
 * Segment delimiter is '.' (dot). Segments are split on dot before matching.
 *
 * NOTE: this lives in _shared/flow-bus/, NOT _shared/flow-engine/. The
 * flow-engine namespace is the existing workflow execution engine. The
 * flow-bus namespace is the new pub/sub bus. Do not cross-import.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type {
  FlowSubscriptionRow,
  RegisterSubscriptionInput,
} from "./types.ts";

// ─── Pattern matching (pure) ──────────────────────────────────────────────

/**
 * Match an event_type string against a subscription pattern.
 *
 * Returns true iff the pattern matches the event_type per the bus's glob
 * grammar. Pure function — no IO, no side effects. Tested independently.
 *
 * Examples:
 *   matchesPattern('deal.stalled', '*')                  → true
 *   matchesPattern('deal.stalled', 'deal.*')             → true
 *   matchesPattern('deal.stalled', 'deal.stalled')       → true
 *   matchesPattern('follow_up.due', 'deal.*')            → false
 *   matchesPattern('deal.stalled.severe', 'deal.*')      → false  (single segment)
 *   matchesPattern('deal.stalled.severe', 'deal.**')     → true   (multi-segment)
 *   matchesPattern('deal.stalled', '')                   → false  (empty pattern)
 *   matchesPattern('', 'deal.*')                         → false  (empty event)
 */
export function matchesPattern(eventType: string, pattern: string): boolean {
  if (eventType.length === 0 || pattern.length === 0) return false;

  // Universal multi-segment match
  if (pattern === "*" || pattern === "**") return true;

  // Literal match (no wildcards in pattern)
  if (!pattern.includes("*")) {
    return eventType === pattern;
  }

  // Glob match — split into segments and walk
  const eventSegments = eventType.split(".");
  const patternSegments = pattern.split(".");

  // Multi-segment glob: pattern ends with '**' — match the prefix and then
  // anything afterwards, including zero segments.
  if (patternSegments[patternSegments.length - 1] === "**") {
    const prefix = patternSegments.slice(0, -1);
    if (eventSegments.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
      if (!matchSegment(eventSegments[i], prefix[i])) return false;
    }
    return true;
  }

  // Standard glob: segment counts must match exactly, each segment compared
  // with single-segment wildcard semantics.
  if (eventSegments.length !== patternSegments.length) return false;
  for (let i = 0; i < eventSegments.length; i += 1) {
    if (!matchSegment(eventSegments[i], patternSegments[i])) return false;
  }
  return true;
}

function matchSegment(eventSegment: string, patternSegment: string): boolean {
  if (patternSegment === "*") return true;
  return eventSegment === patternSegment;
}

// ─── registerSubscription (DB-bound) ──────────────────────────────────────

/**
 * Register a subscription in the `flow_subscriptions` table.
 *
 * Day 6 only writes the row. Day 7+ wires actual handler dispatch through
 * these subscriptions. The registration is idempotent — re-registering the
 * same (workspace_id, event_type_pattern, handler_module, handler_name)
 * tuple is a no-op (the table's UNIQUE constraint catches it).
 *
 * Uses an admin/service-role Supabase client. Same RLS pattern as
 * publish.ts — `flow_subscriptions` insert is service-role only.
 */
export async function registerSubscription(
  client: SupabaseClient,
  input: RegisterSubscriptionInput,
): Promise<FlowSubscriptionRow> {
  if (!input.workspaceId || input.workspaceId.trim().length === 0) {
    throw new Error("workspaceId is required");
  }
  if (!input.eventTypePattern || input.eventTypePattern.trim().length === 0) {
    throw new Error("eventTypePattern is required");
  }
  if (!input.handlerModule || input.handlerModule.trim().length === 0) {
    throw new Error("handlerModule is required");
  }
  if (!input.handlerName || input.handlerName.trim().length === 0) {
    throw new Error("handlerName is required");
  }

  const row = {
    workspace_id: input.workspaceId,
    event_type_pattern: input.eventTypePattern,
    handler_module: input.handlerModule,
    handler_name: input.handlerName,
    enabled: input.enabled ?? true,
  };

  // Upsert: re-registering the same tuple is a no-op.
  const { data, error } = await client
    .from("flow_subscriptions")
    .upsert(row, {
      onConflict: "workspace_id,event_type_pattern,handler_module,handler_name",
    })
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`flow_subscriptions upsert failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("flow_subscriptions upsert returned no row");
  }
  return data as FlowSubscriptionRow;
}

// ─── listActiveSubscriptionsForEvent (DB-bound, used by future dispatcher) ─

/**
 * List all enabled subscriptions in a workspace whose pattern matches the
 * given event_type. Used by the future Day 7+ dispatcher to find handlers
 * for an arriving event.
 *
 * Phase 0 ships this helper for completeness. Day 7+ may push the
 * pattern-matching into SQL via a stored function for performance, but for
 * Phase 0 we fetch all enabled subscriptions and filter in TS — pattern
 * matching is fast and the subscription count is expected to be small
 * (<100 per workspace).
 */
export async function listActiveSubscriptionsForEvent(
  client: SupabaseClient,
  workspaceId: string,
  eventType: string,
): Promise<FlowSubscriptionRow[]> {
  const { data, error } = await client
    .from("flow_subscriptions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true);

  if (error) {
    throw new Error(`flow_subscriptions select failed: ${error.message}`);
  }
  const rows = (data ?? []) as FlowSubscriptionRow[];
  return rows.filter((sub) => matchesPattern(eventType, sub.event_type_pattern));
}
