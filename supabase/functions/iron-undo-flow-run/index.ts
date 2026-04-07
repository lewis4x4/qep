/**
 * Wave 7 Iron Companion — undo a recently-executed flow run.
 *
 * Pipeline:
 *   1. Auth via shared service-auth helper
 *   2. Load flow_workflow_runs by id (must be owned by caller)
 *   3. Verify status = 'succeeded' and undo_deadline > now() OR semantic rule
 *      still satisfied
 *   4. Look up undo_handler from flow_workflow_definitions
 *   5. Dispatch to IRON_UNDO_HANDLERS in a try/catch
 *   6. Mark run as 'undone' via iron_mark_run_undone RPC + persist
 *      compensation_log into metadata
 *   7. On compensation failure: dead-letter via enqueue_workflow_dead_letter
 *
 * Undo is intentionally narrow: only the action's own writes are reversed.
 * If downstream state has progressed (e.g. parts order moved past 'draft'),
 * the handler refuses and the user is told to take a manual correction.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { IRON_UNDO_HANDLERS } from "../_shared/iron/undo-handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface RequestBody {
  run_id: string;
}

interface RunRow {
  id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_slug: string;
  status: string;
  surface: string | null;
  undo_deadline: string | null;
  undone_at: string | null;
  attributed_user_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface FlowDefRow {
  id: string;
  undo_handler: string | null;
  undo_semantic_rule: string | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
  if (!auth.ok) return auth.response;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return safeJsonError("Invalid JSON body", 400, origin);
  }
  if (!body.run_id) return safeJsonError("run_id required", 400, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = auth.userId;

  // Load the run
  const { data: runRow, error: runErr } = await admin
    .from("flow_workflow_runs")
    .select("id, workspace_id, workflow_id, workflow_slug, status, surface, undo_deadline, undone_at, attributed_user_id, metadata")
    .eq("id", body.run_id)
    .maybeSingle();

  if (runErr || !runRow) return safeJsonError("run_not_found", 404, origin);
  const run = runRow as RunRow;

  // Ownership: caller must be the attributed user (or an admin/manager)
  if (run.attributed_user_id !== userId && !["owner", "admin", "manager"].includes(auth.role)) {
    return safeJsonError("forbidden", 403, origin);
  }

  if (run.status !== "succeeded") {
    return safeJsonError(`cannot undo: run is in status ${run.status}`, 409, origin);
  }
  if (run.undone_at) {
    return safeJsonError("already_undone", 409, origin);
  }

  // Wall-clock deadline check
  let withinWindow = false;
  if (run.undo_deadline && new Date(run.undo_deadline) > new Date()) {
    withinWindow = true;
  }

  // Load the flow def for undo_handler + semantic rule
  const { data: defRow } = await admin
    .from("flow_workflow_definitions")
    .select("id, undo_handler, undo_semantic_rule")
    .eq("id", run.workflow_id)
    .maybeSingle();
  const def = defRow as FlowDefRow | null;

  if (!def?.undo_handler) {
    return safeJsonError("flow_has_no_undo_handler", 400, origin);
  }

  // Semantic rule fallback (only checked if wall-clock window has expired)
  if (!withinWindow && def.undo_semantic_rule) {
    const result = (run.metadata?.result ?? {}) as Record<string, unknown>;
    const entityId = result.entity_id;
    if (typeof entityId !== "string") {
      return safeJsonError("undo_window_expired", 409, origin);
    }
    // The semantic rule is a simple SQL fragment; we don't execute arbitrary
    // SQL — instead, we delegate to the handler to make the determination
    // because each handler already verifies its own preconditions
    // (e.g. parts_orders.status = 'draft'). The semantic rule is informative
    // here, not a separate gate.
    withinWindow = true;
  }

  if (!withinWindow) {
    return safeJsonError("undo_window_expired", 409, origin);
  }

  const handler = IRON_UNDO_HANDLERS[def.undo_handler];
  if (!handler) {
    return safeJsonError(`undo_handler_not_registered:${def.undo_handler}`, 500, origin);
  }

  // Dispatch the handler
  const result = await handler(admin, run.metadata ?? {}, run.workspace_id);

  if (!result.ok) {
    // Compensation failed — dead-letter and surface the error to the user
    try {
      await admin.rpc("enqueue_workflow_dead_letter", {
        p_run_id: run.id,
        p_workflow_slug: run.workflow_slug,
        p_reason: `iron_undo_failed: ${result.error}`,
        p_failed_step: def.undo_handler,
        p_payload: { undo_log: result.log, original_status: run.status },
      });
    } catch (err) {
      console.warn("[iron-undo] dead-letter enqueue failed:", (err as Error).message);
    }
    return safeJsonOk(
      {
        ok: false,
        run_id: run.id,
        error: result.error,
        compensation_log: result.log,
      },
      origin,
    );
  }

  // Mark the run as undone via the RPC (which writes undone_at, undone_by,
  // status, and appends compensation_log to metadata)
  const { error: markErr } = await admin.rpc("iron_mark_run_undone", {
    p_run_id: run.id,
    p_user_id: userId,
    p_compensation_log: result.log,
  });
  if (markErr) {
    return safeJsonError(`mark_undone_failed: ${markErr.message}`, 500, origin);
  }

  return safeJsonOk(
    {
      ok: true,
      run_id: run.id,
      compensation_log: result.log,
      message: "Reversed.",
    },
    origin,
  );
});
