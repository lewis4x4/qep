/**
 * QEP Flow Engine — flow-runner edge function (Slice 1)
 *
 * Polls `analytics_events` for unprocessed flow events, matches them
 * against enabled `flow_workflow_definitions`, and executes the action
 * chain via the registry. Logs every step to `flow_workflow_run_steps`
 * and dead-letters terminal failures into `exception_queue` via
 * `enqueue_workflow_dead_letter`.
 *
 * Auth:
 *   • Cron callers: x-internal-service-secret header
 *   • Manual triggers (admin "Run now" button): owner JWT
 *
 * Cadence: invoked every 60s by pg_cron (registered in a future migration
 * once the runner is proven). Manual invocations are always allowed.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { evaluateConditions, computeIdempotencyKey } from "../_shared/flow-engine/condition-eval.ts";
import { getAction, ACTION_REGISTRY } from "../_shared/flow-engine/registry.ts";
import type {
  FlowContext,
  FlowEvent,
  FlowWorkflowDefinition,
  FlowActionResult,
} from "../_shared/flow-engine/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SERVICE_SECRET") ?? "";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const POLL_BATCH_SIZE = 200;
const MAX_RUNTIME_MS = 50_000; // leave headroom under 60s cron tick

interface RunnerResult {
  events_processed: number;
  workflows_evaluated: number;
  runs_created: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_dead_lettered: number;
  duration_ms: number;
}

async function isAuthorizedCaller(req: Request, admin: SupabaseClient): Promise<boolean> {
  const internalSecret = req.headers.get("x-internal-service-secret");
  if (internalSecret && INTERNAL_SECRET && internalSecret === INTERNAL_SECRET) return true;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  try {
    const { data: userRes } = await admin.auth.getUser(auth.slice(7));
    const userId = userRes?.user?.id;
    if (!userId) return false;
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    return profile?.role === "owner";
  } catch {
    return false;
  }
}

/** Glob match: 'quote.*' matches 'quote.expired'; exact otherwise. */
function patternMatches(pattern: string, eventType: string): boolean {
  if (pattern === eventType) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(prefix + ".");
  }
  if (pattern === "*") return true;
  return false;
}

/** Build a minimal FlowContext. Slice 3 fills in company/deal/health hydration. */
function buildContextFromEvent(event: FlowEvent): FlowContext {
  return {
    event,
    recent_runs: [],
  };
}

async function executeRun(
  admin: SupabaseClient,
  def: FlowWorkflowDefinition & { id: string },
  event: FlowEvent,
): Promise<{ status: string; runId: string; deadLettered: boolean }> {
  // 1. Create run row
  const runStart = Date.now();
  const { data: runRow, error: runErr } = await admin.from("flow_workflow_runs").insert({
    workspace_id: event.workspace_id,
    workflow_id: def.id,
    workflow_slug: def.slug,
    event_id: event.event_id,
    status: "running",
    dry_run: def.dry_run ?? false,
    metadata: { trigger_pattern: def.trigger_event_pattern },
  }).select("id").maybeSingle();

  if (runErr || !runRow) {
    console.error("[flow-runner] failed to create run row:", runErr);
    return { status: "failed", runId: "", deadLettered: false };
  }

  const runId = runRow.id as string;
  const context = buildContextFromEvent(event);

  // Audit: run start
  try {
    await admin.from("analytics_action_log").insert({
      workspace_id: event.workspace_id,
      action_type: "flow_run_start",
      source_widget: "flow-runner",
      metadata: { run_id: runId, workflow_slug: def.slug, event_id: event.event_id },
    });
  } catch { /* swallow */ }

  // 2. Evaluate conditions
  let conditionsPassed = true;
  try {
    conditionsPassed = evaluateConditions(def.conditions ?? [], context);
  } catch (err) {
    console.warn(`[flow-runner] condition eval failed for ${def.slug}:`, (err as Error).message);
    conditionsPassed = false;
  }

  if (!conditionsPassed) {
    await admin.from("flow_workflow_run_steps").insert({
      run_id: runId,
      step_index: 0,
      step_type: "condition",
      status: "skipped",
      result: { reason: "conditions_not_met" },
      finished_at: new Date().toISOString(),
    });
    await admin.from("flow_workflow_runs").update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - runStart,
    }).eq("id", runId);
    await admin.rpc("mark_event_consumed", { p_event_id: event.event_id, p_run_id: runId });
    return { status: "skipped", runId, deadLettered: false };
  }

  // 3. Execute action chain
  let allSucceeded = true;
  let anyFailed = false;
  let deadLettered = false;

  for (let i = 0; i < (def.actions ?? []).length; i++) {
    const step = def.actions[i];
    const stepStart = Date.now();

    // Validate action exists in registry
    let action;
    try {
      action = getAction(step.action_key);
    } catch (err) {
      // Slice 1: empty registry, so every action will fail this lookup.
      // We log it as 'skipped' instead of failing the run so the runner
      // can prove its plumbing without ACTION_REGISTRY entries.
      await admin.from("flow_workflow_run_steps").insert({
        run_id: runId,
        step_index: i,
        step_type: "action",
        action_key: step.action_key,
        params: step.params,
        status: "skipped",
        error_text: (err as Error).message,
        finished_at: new Date().toISOString(),
      });
      continue;
    }

    const idempotencyKey = computeIdempotencyKey(action.idempotency_key_template, context);

    // Check idempotency
    const { data: priorResult } = await admin
      .from("flow_action_idempotency")
      .select("result")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (priorResult?.result) {
      await admin.from("flow_workflow_run_steps").insert({
        run_id: runId,
        step_index: i,
        step_type: "action",
        action_key: step.action_key,
        params: step.params,
        idempotency_key: idempotencyKey,
        status: "skipped",
        result: { ...priorResult.result, idempotency_hit: true },
        started_at: new Date(stepStart).toISOString(),
        finished_at: new Date().toISOString(),
      });
      continue;
    }

    // Execute the action
    let result: FlowActionResult;
    try {
      result = await action.execute(step.params, context, {
        admin,
        workspace_id: event.workspace_id,
        run_id: runId,
        step_index: i,
        dry_run: def.dry_run ?? false,
      });
    } catch (err) {
      result = { status: "failed", error: (err as Error).message, retryable: false };
    }

    // Persist step row
    await admin.from("flow_workflow_run_steps").insert({
      run_id: runId,
      step_index: i,
      step_type: "action",
      action_key: step.action_key,
      params: step.params,
      idempotency_key: idempotencyKey,
      status: result.status === "succeeded" ? "succeeded" : result.status === "skipped" ? "skipped" : "failed",
      result: result.status !== "failed" ? (result as { result?: Record<string, unknown> }).result ?? null : null,
      error_text: result.status === "failed" ? result.error : null,
      started_at: new Date(stepStart).toISOString(),
      finished_at: new Date().toISOString(),
    });

    // On success, write the idempotency record
    if (result.status === "succeeded" && !def.dry_run) {
      try {
        await admin.from("flow_action_idempotency").insert({
          idempotency_key: idempotencyKey,
          workspace_id: event.workspace_id,
          run_id: runId,
          action_key: step.action_key,
          result: (result as { result: Record<string, unknown> }).result,
        });
      } catch { /* swallow — race on concurrent runs is fine */ }
    }

    if (result.status === "failed") {
      anyFailed = true;
      allSucceeded = false;
      if (step.on_failure === "abort" || !step.on_failure) {
        // Dead-letter the run on first hard failure (Slice 1 default).
        // Slice 2 wires retries via retry_policy.
        await admin.rpc("enqueue_workflow_dead_letter", {
          p_run_id: runId,
          p_workflow_slug: def.slug,
          p_reason: result.error,
          p_failed_step: step.action_key,
          p_payload: { event_id: event.event_id, step_index: i },
        });
        deadLettered = true;
        break;
      }
    }
  }

  // 4. Finalize run state
  if (!deadLettered) {
    const finalStatus = allSucceeded ? "succeeded" : anyFailed ? "partially_succeeded" : "succeeded";
    await admin.from("flow_workflow_runs").update({
      status: finalStatus,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - runStart,
    }).eq("id", runId);
    try {
      await admin.from("analytics_action_log").insert({
        workspace_id: event.workspace_id,
        action_type: "flow_run_complete",
        source_widget: "flow-runner",
        metadata: { run_id: runId, workflow_slug: def.slug, status: finalStatus },
      });
    } catch { /* swallow */ }
  } else {
    try {
      await admin.from("analytics_action_log").insert({
        workspace_id: event.workspace_id,
        action_type: "flow_run_dead_letter",
        source_widget: "flow-runner",
        metadata: { run_id: runId, workflow_slug: def.slug },
      });
    } catch { /* swallow */ }
  }

  await admin.rpc("mark_event_consumed", { p_event_id: event.event_id, p_run_id: runId });

  return {
    status: deadLettered ? "dead_lettered" : allSucceeded ? "succeeded" : "partially_succeeded",
    runId,
    deadLettered,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (!(await isAuthorizedCaller(req, admin))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const tickStart = Date.now();
  const result: RunnerResult = {
    events_processed: 0,
    workflows_evaluated: 0,
    runs_created: 0,
    runs_succeeded: 0,
    runs_failed: 0,
    runs_dead_lettered: 0,
    duration_ms: 0,
  };

  try {
    // Load enabled workflow definitions
    const { data: defs, error: defsErr } = await admin
      .from("flow_workflow_definitions")
      .select("id, slug, name, owner_role, trigger_event_pattern, condition_dsl, action_chain, retry_policy, dry_run, enabled, affects_modules")
      .eq("enabled", true);
    if (defsErr) throw new Error(`load definitions: ${defsErr.message}`);

    const definitions: Array<FlowWorkflowDefinition & { id: string; condition_dsl?: unknown; action_chain?: unknown }> =
      (defs ?? []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        slug: d.slug as string,
        name: d.name as string,
        description: "",
        owner_role: (d.owner_role as FlowWorkflowDefinition["owner_role"]) ?? "shared",
        trigger_event_pattern: d.trigger_event_pattern as string,
        conditions: Array.isArray(d.condition_dsl) ? (d.condition_dsl as never) : [],
        actions: Array.isArray(d.action_chain) ? (d.action_chain as never) : [],
        affects_modules: Array.isArray(d.affects_modules) ? (d.affects_modules as string[]) : [],
        dry_run: d.dry_run as boolean,
        enabled: true,
      }));

    // Poll a batch of unprocessed events
    const { data: events, error: eventsErr } = await admin
      .from("analytics_events")
      .select("event_id, flow_event_type, source_module, workspace_id, entity_type, entity_id, occurred_at, properties, correlation_id, parent_event_id, consumed_by_runs")
      .not("flow_event_type", "is", null)
      .eq("consumed_by_runs", "[]")
      .order("occurred_at", { ascending: true })
      .limit(POLL_BATCH_SIZE);
    if (eventsErr) throw new Error(`poll events: ${eventsErr.message}`);

    for (const row of (events ?? []) as Record<string, unknown>[]) {
      if (Date.now() - tickStart > MAX_RUNTIME_MS) break;
      result.events_processed++;

      const event: FlowEvent = {
        event_id: row.event_id as string,
        flow_event_type: row.flow_event_type as string,
        source_module: (row.source_module as string) ?? "unknown",
        workspace_id: (row.workspace_id as string) ?? "default",
        entity_type: (row.entity_type as string) ?? null,
        entity_id: (row.entity_id as string) ?? null,
        occurred_at: row.occurred_at as string,
        properties: (row.properties as Record<string, unknown>) ?? {},
        correlation_id: (row.correlation_id as string) ?? null,
        parent_event_id: (row.parent_event_id as string) ?? null,
      };

      const matched = definitions.filter((d) => patternMatches(d.trigger_event_pattern, event.flow_event_type));
      result.workflows_evaluated += matched.length;

      if (matched.length === 0) {
        // No subscribers — mark consumed with the synthetic 'no_match' run id
        // so the poll doesn't return it again.
        await admin
          .from("analytics_events")
          .update({ consumed_by_runs: ["no_match"] })
          .eq("event_id", event.event_id);
        continue;
      }

      for (const def of matched) {
        if (Date.now() - tickStart > MAX_RUNTIME_MS) break;
        try {
          const r = await executeRun(admin, def, event);
          result.runs_created++;
          if (r.deadLettered) result.runs_dead_lettered++;
          else if (r.status === "succeeded") result.runs_succeeded++;
          else result.runs_failed++;
        } catch (err) {
          console.error(`[flow-runner] run failed for ${def.slug}:`, err);
          result.runs_failed++;
        }
      }
    }

    result.duration_ms = Date.now() - tickStart;

    // Cron audit
    try {
      await admin.from("service_cron_runs").insert({
        workspace_id: "default",
        job_name: "flow-runner",
        started_at: new Date(tickStart).toISOString(),
        finished_at: new Date().toISOString(),
        ok: true,
        metadata: { ...result, registry_size: Object.keys(ACTION_REGISTRY).length },
      });
    } catch { /* swallow */ }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[flow-runner] fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message, ...result }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
