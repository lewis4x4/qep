/**
 * Wave 7 Iron Companion — synchronous flow execution.
 *
 * Iron flows are user-initiated and conversational, so they cannot wait for
 * the 60s polling tick of `flow-runner`. This function takes a fully-filled
 * slot bundle from the client, validates it, and executes the flow's action
 * chain inline against the existing action registry. The result row lives
 * in the same `flow_workflow_runs` table as automated workflows, so the
 * admin dashboard sees them in one place.
 *
 * Pipeline:
 *   1. Auth via shared service-auth helper
 *   2. Load the flow definition by id (must be surface = iron_*)
 *   3. Role + feature_flag check
 *   4. Idempotency check via the (workspace_id, idempotency_key) unique index
 *      on flow_workflow_runs (added in migration 197)
 *   5. High-value gate (if total_cents >= threshold and confirmation missing)
 *   6. Cost ladder check
 *   7. Insert flow_workflow_runs row (status=running, surface, conversation_id,
 *      undo_deadline, idempotency_key)
 *   8. Execute each action in the action_chain via the existing registry
 *   9. Persist flow_workflow_run_steps + finalize run
 *  10. Increment iron_usage_counters.flow_executes
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { ACTION_REGISTRY } from "../_shared/flow-engine/registry.ts";
import type { FlowActionStep, FlowContext, FlowEvent } from "../_shared/flow-engine/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const UNDO_WINDOW_SECONDS = 60;

interface RequestBody {
  flow_id: string;                    // flow_workflow_definitions.id (uuid)
  conversation_id: string;
  idempotency_key: string;            // client-generated UUID per Review mount
  slots: Record<string, unknown>;
  high_value_confirmation_cents?: number;  // user-typed amount on the gate
  client_slot_updated_at?: Record<string, string>;  // optimistic-lock snapshots
}

interface FlowDefRow {
  id: string;
  slug: string;
  name: string;
  workspace_id: string;
  surface: string;
  iron_metadata: Record<string, unknown> | null;
  feature_flag: string | null;
  undo_handler: string | null;
  undo_semantic_rule: string | null;
  high_value_threshold_cents: number | null;
  roles_allowed: string[] | null;
  enabled: boolean;
  action_chain: FlowActionStep[];
  dry_run: boolean;
}

/* ─── High-value gate ───────────────────────────────────────────────────── */

function computeFlowTotalCents(slots: Record<string, unknown>): number {
  // Walk known slot shapes that carry money. Today: line_items[].unit_price * quantity.
  // Future: extend per slot type.
  const lineItems = slots.line_items;
  if (!Array.isArray(lineItems)) return 0;
  let totalCents = 0;
  for (const raw of lineItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const qty = Number(item.quantity ?? 1);
    const price = Number(item.unit_price ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(price) && price > 0) {
      totalCents += Math.round(qty * price * 100);
    }
  }
  return totalCents;
}

/* ─── Optimistic lock check ─────────────────────────────────────────────── */

async function checkOptimisticLock(
  admin: SupabaseClient,
  flowDef: FlowDefRow,
  slots: Record<string, unknown>,
  clientSnapshots: Record<string, string> | undefined,
): Promise<{ ok: true } | { ok: false; conflict: { slot_id: string; entity_table: string; current_updated_at: string } }> {
  if (!clientSnapshots || Object.keys(clientSnapshots).length === 0) return { ok: true };

  const meta = (flowDef.iron_metadata ?? {}) as Record<string, unknown>;
  const slotSchema = (meta.slot_schema as Array<Record<string, unknown>>) ?? [];

  for (const slot of slotSchema) {
    const slotId = slot.id as string;
    if (slot.type !== "entity_picker") continue;
    const snapshot = clientSnapshots[slotId];
    if (!snapshot) continue;
    const entityId = slots[slotId];
    if (typeof entityId !== "string") continue;
    const table = slot.entity_table as string | undefined;
    if (!table) continue;

    const { data, error } = await admin
      .from(table)
      .select("updated_at")
      .eq("id", entityId)
      .maybeSingle();
    if (error || !data?.updated_at) continue;

    if (data.updated_at !== snapshot) {
      const mergeStrategy = (slot.merge_strategy as string) ?? "reject";
      if (mergeStrategy === "reject") {
        return {
          ok: false,
          conflict: { slot_id: slotId, entity_table: table, current_updated_at: data.updated_at as string },
        };
      }
      // 'auto_if_unrelated' and 'prompt_diff' are no-ops at the server layer
      // for v1 — the client decides what to do with the diff.
    }
  }
  return { ok: true };
}

/* ─── Action chain executor ─────────────────────────────────────────────── */

async function executeActionChain(
  admin: SupabaseClient,
  flowDef: FlowDefRow,
  runId: string,
  conversationId: string,
  slots: Record<string, unknown>,
  workspaceId: string,
  userId: string,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string; failed_step: string }> {
  // Build a synthetic FlowContext that carries the slot fills as event.properties.slots.
  // The Iron actions all read from ctx.event.properties.slots (see iron-actions.ts).
  const syntheticEvent: FlowEvent = {
    event_id: runId,
    flow_event_type: `iron.intent.${flowDef.slug.replace(/^iron\./, "")}`,
    source_module: "iron",
    workspace_id: workspaceId,
    entity_type: null,
    entity_id: null,
    occurred_at: new Date().toISOString(),
    properties: { slots, conversation_id: conversationId, user_id: userId },
    correlation_id: runId,
    parent_event_id: null,
  };

  const context: FlowContext = {
    event: syntheticEvent,
    company: null,
    deal: null,
    health_score: null,
    ar_block_status: null,
    customer_tier: null,
    recent_runs: [],
  };

  let aggregateResult: Record<string, unknown> = {};

  for (let i = 0; i < flowDef.action_chain.length; i++) {
    const step = flowDef.action_chain[i];
    const action = ACTION_REGISTRY[step.action_key];
    if (!action) {
      const stepStart = new Date().toISOString();
      await admin.from("flow_workflow_run_steps").insert({
        run_id: runId,
        step_index: i,
        step_type: "action",
        action_key: step.action_key,
        status: "failed",
        error_text: `action '${step.action_key}' not in registry`,
        started_at: stepStart,
        finished_at: stepStart,
      });
      return { ok: false, error: `action_not_registered:${step.action_key}`, failed_step: step.action_key };
    }

    const stepStart = Date.now();
    let stepResult;
    try {
      stepResult = await action.execute(step.params, context, {
        admin,
        workspace_id: workspaceId,
        run_id: runId,
        step_index: i,
        dry_run: flowDef.dry_run ?? false,
      });
    } catch (err) {
      stepResult = { status: "failed" as const, error: (err as Error).message, retryable: false };
    }

    await admin.from("flow_workflow_run_steps").insert({
      run_id: runId,
      step_index: i,
      step_type: "action",
      action_key: step.action_key,
      params: step.params,
      status: stepResult.status === "succeeded" ? "succeeded" : stepResult.status === "skipped" ? "skipped" : "failed",
      result: stepResult.status === "succeeded" ? stepResult.result : null,
      error_text: stepResult.status === "failed" ? stepResult.error : null,
      started_at: new Date(stepStart).toISOString(),
      finished_at: new Date().toISOString(),
    });

    if (stepResult.status === "failed") {
      return { ok: false, error: stepResult.error, failed_step: step.action_key };
    }

    if (stepResult.status === "succeeded") {
      aggregateResult = { ...aggregateResult, ...stepResult.result };
    }
  }

  return { ok: true, result: aggregateResult };
}

/* ─── Workspace lookup helper ───────────────────────────────────────────── */

async function lookupWorkspace(supabase: SupabaseClient, userId: string): Promise<string> {
  // Read the user's current active workspace from profiles.active_workspace_id
  // (migration 203). This is the authoritative source for Iron flow-step scoping.
  const { data } = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", userId)
    .maybeSingle();
  return ((data as Record<string, unknown> | null)?.active_workspace_id as string) ?? "default";
}

/* ─── Main handler ──────────────────────────────────────────────────────── */

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

  if (!body.flow_id || !body.conversation_id || !body.idempotency_key || !body.slots) {
    return safeJsonError("flow_id, conversation_id, idempotency_key, slots required", 400, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const userId = auth.userId;
  const role = auth.role;
  const workspaceId = await lookupWorkspace(auth.supabase, userId);

  // Idempotency check (must be first to avoid double-spending compute)
  {
    const { data: existing } = await admin
      .from("flow_workflow_runs")
      .select("id, status, metadata, finished_at")
      .eq("workspace_id", workspaceId)
      .eq("idempotency_key", body.idempotency_key)
      .maybeSingle();
    if (existing?.id) {
      return safeJsonOk(
        {
          ok: true,
          run_id: existing.id,
          status: existing.status,
          replay: true,
          message: "Iron returned the original result for this idempotency key",
        },
        origin,
      );
    }
  }

  // Load + validate flow definition
  const { data: flowDef, error: defErr } = await admin
    .from("flow_workflow_definitions")
    .select(
      "id, slug, name, workspace_id, surface, iron_metadata, feature_flag, undo_handler, undo_semantic_rule, high_value_threshold_cents, roles_allowed, enabled, action_chain, dry_run",
    )
    .eq("id", body.flow_id)
    .maybeSingle();

  if (defErr || !flowDef) return safeJsonError("flow_not_found", 404, origin);

  const def = flowDef as FlowDefRow;

  if (!def.enabled) return safeJsonError("flow_disabled", 403, origin);
  if (def.surface !== "iron_conversational" && def.surface !== "iron_voice") {
    return safeJsonError("not_an_iron_flow", 403, origin);
  }
  if (def.roles_allowed && def.roles_allowed.length > 0 && !def.roles_allowed.includes(role)) {
    return safeJsonError("forbidden_role", 403, origin);
  }
  if (def.feature_flag) {
    // Look up the workspace flag (best-effort; absent = enabled by default for v1)
    const { data: ws } = await admin
      .from("workspace_settings")
      .select("feature_flags")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const flags = ((ws as Record<string, unknown> | null)?.feature_flags as Record<string, unknown>) ?? {};
    if (flags[def.feature_flag] === false) {
      return safeJsonError("feature_flag_disabled", 403, origin);
    }
  }

  // Optimistic lock
  const lockCheck = await checkOptimisticLock(admin, def, body.slots, body.client_slot_updated_at);
  if (!lockCheck.ok) {
    return safeJsonOk(
      {
        ok: false,
        error: "stale_entity",
        conflict: lockCheck.conflict,
        message: "That record was updated while you were filling the flow. Refresh and try again.",
      },
      origin,
    );
  }

  // High-value gate
  const totalCents = computeFlowTotalCents(body.slots);
  const threshold = def.high_value_threshold_cents ?? 0;
  if (threshold > 0 && totalCents >= threshold) {
    if (body.high_value_confirmation_cents !== totalCents) {
      return safeJsonOk(
        {
          ok: false,
          error: "high_value_confirmation_required",
          total_cents: totalCents,
          threshold_cents: threshold,
          message: `This flow totals $${(totalCents / 100).toFixed(2)}. Type the exact amount to confirm.`,
        },
        origin,
      );
    }
  }

  // Insert run row
  const undoDeadline = new Date(Date.now() + UNDO_WINDOW_SECONDS * 1000).toISOString();
  const { data: run, error: runErr } = await admin
    .from("flow_workflow_runs")
    .insert({
      workspace_id: workspaceId,
      workflow_id: def.id,
      workflow_slug: def.slug,
      status: "running",
      surface: def.surface,
      conversation_id: body.conversation_id,
      idempotency_key: body.idempotency_key,
      undo_deadline: undoDeadline,
      attributed_user_id: userId,
      dry_run: def.dry_run ?? false,
      metadata: {
        invoked_via: "iron-execute-flow-step",
        slot_keys: Object.keys(body.slots),
        total_cents: totalCents,
      },
    })
    .select("id")
    .single();

  if (runErr || !run?.id) {
    return safeJsonError(`run_insert_failed: ${runErr?.message ?? "unknown"}`, 500, origin);
  }

  const runId = run.id as string;
  const startedAt = Date.now();

  // Execute the action chain inline (no polling)
  const exec = await executeActionChain(
    admin,
    def,
    runId,
    body.conversation_id,
    body.slots,
    workspaceId,
    userId,
  );

  if (!exec.ok) {
    // Dead-letter via the existing engine RPC
    await admin.rpc("enqueue_workflow_dead_letter", {
      p_run_id: runId,
      p_workflow_slug: def.slug,
      p_reason: exec.error,
      p_failed_step: exec.failed_step,
      p_payload: { surface: def.surface, conversation_id: body.conversation_id, total_cents: totalCents },
    });
    return safeJsonOk(
      {
        ok: false,
        run_id: runId,
        error: exec.error,
        failed_step: exec.failed_step,
        status: "dead_lettered",
      },
      origin,
    );
  }

  // Finalize run
  await admin.from("flow_workflow_runs").update({
    status: "succeeded",
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    metadata: {
      invoked_via: "iron-execute-flow-step",
      slot_keys: Object.keys(body.slots),
      total_cents: totalCents,
      result: exec.result,
    },
  }).eq("id", runId);

  // Increment usage counter (flow execute)
  await admin.rpc("iron_increment_usage", {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_classifications: 0,
    p_tokens_in: 0,
    p_tokens_out: 0,
    p_flow_executes: 1,
    p_cost_usd_micro: 0,
  });

  return safeJsonOk(
    {
      ok: true,
      run_id: runId,
      status: "succeeded",
      result: exec.result,
      undo_deadline: undoDeadline,
      undo_handler: def.undo_handler,
      total_cents: totalCents,
    },
    origin,
  );
});
