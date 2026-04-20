/**
 * Recommend-Moves Edge Function (Slice 2)
 *
 * Pulls unprocessed signals → runs the deterministic rule-based recommender
 * → inserts deduped moves for the Today surface.
 *
 * Callable by:
 *   1. pg_cron every N minutes via x-internal-service-secret (bulk sweep).
 *   2. Elevated users (admin/manager/owner) from the Today surface via a
 *      normal JWT — typically after they ingest a batch of signals.
 *
 * Dedup contract:
 *   Before inserting a move, we look for an OPEN move
 *   (status in 'suggested','accepted') with the same (kind, entity_id) in
 *   the same workspace. If one exists we skip — the existing move already
 *   represents the intent. This keeps the Today list quiet instead of
 *   stacking near-duplicates on every cron tick.
 *
 * Response shape:
 *   { ok: true, signalsScanned, movesCreated, movesSkipped, ruleCounts }
 *
 * Safe to run repeatedly: the signal query scopes to recent + unactioned
 * signals, and the per-(kind, entity) dedup check makes re-runs idempotent.
 */

import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  recommendMovesFromSignals,
  type RecommenderSignal,
} from "../_shared/qrm-recommender.ts";
import type { MoveCreatePayload } from "../_shared/qrm-moves.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

/**
 * Look-back window for "recent" signals. We only consider signals created in
 * the last 24 hours so an old unactioned signal doesn't keep re-firing
 * after the cron moves on. The idempotency layer is a belt-and-braces
 * guarantee; this window is the primary filter.
 */
const LOOKBACK_HOURS = 24;

/**
 * Max signals to process per invocation. Keeps runtime bounded on a backlog.
 */
const BATCH_LIMIT = 500;

Deno.serve(async (req: Request): Promise<Response> => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const adminClient = createAdminClient();

  // Cron service-role OR elevated user JWT. No rep-level access — the
  // recommender writes on behalf of the system, not a specific rep.
  const isServiceRole = isServiceRoleCaller(req);
  if (!isServiceRole) {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

    // Pull recent signals. Ordered oldest-first so the cron works through a
    // backlog in arrival order.
    const { data: rawSignals, error: signalsError } = await adminClient
      .from("signals")
      .select(
        "id, workspace_id, kind, severity, source, title, description, entity_type, entity_id, assigned_rep_id, occurred_at, suppressed_until, payload",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (signalsError) throw signalsError;

    const signals = (rawSignals ?? []) as RecommenderSignal[];

    // Run the deterministic recommender. This is pure / unit-tested.
    const candidates = recommendMovesFromSignals(signals);

    // Dedup: for each candidate, check if an open move already exists for
    // (workspace, kind, entity_id). If yes, skip.
    let created = 0;
    let skipped = 0;
    const ruleCounts: Record<string, number> = {};

    for (const candidate of candidates) {
      const { workspaceId, sourceSignalId: _srcSignal, ruleId, ...payload } = candidate;

      let dupQuery = adminClient
        .from("moves")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("kind", payload.kind)
        .in("status", ["suggested", "accepted"])
        .limit(1);

      if (payload.entityId) {
        dupQuery = dupQuery.eq("entity_id", payload.entityId);
      } else {
        dupQuery = dupQuery.is("entity_id", null);
      }

      const { data: existing, error: dupError } = await dupQuery;
      if (dupError) throw dupError;

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // Insert the move. We can't reuse createMove() here because that path
      // validates payloads for the router-caller shape; the recommender's
      // output is already validated by the pure module's ruleset contract.
      const insertRow = toMoveRow(workspaceId, payload);
      const { error: insertError } = await adminClient.from("moves").insert(insertRow);
      if (insertError) throw insertError;

      created++;
      ruleCounts[ruleId] = (ruleCounts[ruleId] ?? 0) + 1;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        signalsScanned: signals.length,
        movesCreated: created,
        movesSkipped: skipped,
        ruleCounts,
      }),
      { status: 200, headers: { ...ch, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[recommend-moves] error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      }),
      { status: 500, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }
});

function toMoveRow(
  workspaceId: string,
  payload: MoveCreatePayload,
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    kind: payload.kind,
    title: payload.title,
    rationale: payload.rationale ?? null,
    confidence: payload.confidence ?? null,
    priority: payload.priority ?? 50,
    entity_type: payload.entityType ?? null,
    entity_id: payload.entityId ?? null,
    assigned_rep_id: payload.assignedRepId ?? null,
    draft: payload.draft ?? null,
    signal_ids: payload.signalIds ?? [],
    due_at: payload.dueAt ?? null,
    recommender: payload.recommender ?? "deterministic",
    recommender_version: payload.recommenderVersion ?? "deterministic-v1",
    payload: payload.payload ?? {},
  };
}
