import { resolveReplayContext, completedReplayStep } from "../_shared/flow-engine/replay-context.ts";
/**
 * QEP Flow Engine — flow-runner handler (Slice 1)
 *
 * Polls `flow_pending_events` for unprocessed flow events, matches them
 * against enabled `flow_workflow_definitions`, and executes the action
 * chain via the registry.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (owner): always uses profiles.active_workspace_id via
 *   resolveCallerContext. Body `workspace` / `workspace_id` is ignored.
 *   Missing active workspace fails closed (403) with no flow-table access.
 * - Service role / cron / x-internal-service-secret: unscoped (all shops)
 *   when no workspace hint, or optional `x-workspace-id` header and/or body
 *   `workspace` / `workspace_id` to narrow to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { evaluateConditions, computeIdempotencyKey, resolveParamsForRun } from "../_shared/flow-engine/condition-eval.ts";
import { getAction, ACTION_REGISTRY } from "../_shared/flow-engine/registry.ts";
import type {
  FlowContext,
  FlowEvent,
  FlowWorkflowDefinition,
  FlowActionResult,
} from "../_shared/flow-engine/types.ts";
import { voiceCaptureToQrm } from "../_shared/flow-workflows/voice-capture-to-qrm.ts";
import { quoteExpiringSoon } from "../_shared/flow-workflows/quote-expiring-soon.ts";
import { partsReceivedForOpenJob } from "../_shared/flow-workflows/parts-received-for-open-job.ts";
import { arAgedPastThreshold } from "../_shared/flow-workflows/ar-aged-past-threshold.ts";
import { serviceDelayStrategicAccount } from "../_shared/flow-workflows/service-delay-strategic-account.ts";
import { arOverrideRequest } from "../_shared/flow-workflows/ar-override-request.ts";
import { priceFileImported } from "../_shared/flow-workflows/price-file-imported.ts";
import { equipmentHoursCrossedInterval } from "../_shared/flow-workflows/equipment-hours-crossed-interval.ts";
import { rentalNearingEnd } from "../_shared/flow-workflows/rental-nearing-end.ts";
import { competitorSignalFromVoice } from "../_shared/flow-workflows/competitor-signal-from-voice.ts";
import { quoteManagerApproval } from "../_shared/flow-workflows/quote-manager-approval.ts";
import { dealDepositMakeReady } from "../_shared/flow-workflows/deal-deposit-make-ready.ts";
import { dealClosedWonFleet } from "../_shared/flow-workflows/deal-closed-won-fleet.ts";
import { IRON_FLOW_DEFINITIONS } from "../_shared/flow-workflows/iron-flows.ts";
import { RENTAL_FLOW_DEFINITIONS } from "../_shared/flow-workflows/rental-lifecycle-flows.ts";
import {
  telematicsFaultCustomerIntake,
  telematicsFaultRentalService,
} from "../_shared/flow-workflows/telematics-fault-service.ts";

/** All workflow files known to this build. Auto-synced into the DB on every tick. */
export const REGISTERED_WORKFLOWS: FlowWorkflowDefinition[] = [
  voiceCaptureToQrm,
  quoteExpiringSoon,
  partsReceivedForOpenJob,
  arAgedPastThreshold,
  serviceDelayStrategicAccount,
  arOverrideRequest,
  priceFileImported,
  equipmentHoursCrossedInterval,
  rentalNearingEnd,
  competitorSignalFromVoice,
  quoteManagerApproval,
  dealDepositMakeReady,
  dealClosedWonFleet,
  telematicsFaultRentalService,
  telematicsFaultCustomerIntake,
  ...IRON_FLOW_DEFINITIONS,
  ...RENTAL_FLOW_DEFINITIONS,
];

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

export const POLL_BATCH_SIZE = 200;
export const MAX_RUNTIME_MS = 50_000;

export interface RequestBody {
  workspace?: unknown;
  workspace_id?: unknown;
}

export type FlowRunnerWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type FlowRunnerAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export interface RunnerResult {
  events_processed: number;
  workflows_evaluated: number;
  runs_created: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_dead_lettered: number;
  duration_ms: number;
}

export function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret, x-workspace-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0 || internalSecret.length > 0;
}

export function resolveFlowRunnerWorkspaceScope(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
  headerWorkspaceId?: string | null;
}): FlowRunnerWorkspaceScope {
  if (!params.isServiceRole) {
    const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
    if (!workspaceId) {
      return { mode: "scoped", workspaceId: "" };
    }
    return { mode: "scoped", workspaceId };
  }

  const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
    normalizeWorkspaceId(params.headerWorkspaceId);
  if (explicit) {
    return { mode: "scoped", workspaceId: explicit };
  }
  return { mode: "unscoped" };
}

export async function authenticateFlowRunner(
  req: Request,
  adminClient: SupabaseClient,
): Promise<FlowRunnerAuthResult> {
  if (isServiceRoleCaller(req)) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: normalizeWorkspaceId(req.headers.get("x-workspace-id")),
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  const caller = await resolveCallerContext(req, adminClient);

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (caller.role !== "owner") {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
  };
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Glob match: 'quote.*' matches 'quote.expired'; exact otherwise. */
export function patternMatches(pattern: string, eventType: string): boolean {
  if (pattern === eventType) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(prefix + ".");
  }
  if (pattern === "*") return true;
  return false;
}

export function workflowMatchesEvent(def: { slug: string; trigger_event_pattern: string }, event: FlowEvent): boolean {
  const target = event.properties.resumed_workflow_slug;
  return (target == null || target === def.slug) && patternMatches(def.trigger_event_pattern, event.flow_event_type);
}

/** Build a FlowContext: calls flow_resolve_context (Slice 3) for hydration. */
async function buildContextFromEvent(admin: SupabaseClient, event: FlowEvent): Promise<FlowContext> {
  let resolved: Record<string, unknown> | null = null;
  try {
    const { data } = await admin.rpc("flow_resolve_context", { p_event_id: event.event_id });
    if (data && typeof data === "object") resolved = data as Record<string, unknown>;
  } catch (err) {
    console.warn(`[flow-runner] context resolve failed for ${event.event_id}:`, (err as Error).message);
  }
  return {
    event,
    company: (resolved?.company as Record<string, unknown>) ?? null,
    deal: (resolved?.deal as Record<string, unknown>) ?? null,
    health_score: (resolved?.health_score as number) ?? null,
    ar_block_status: (resolved?.ar_block_status as string) ?? null,
    customer_tier: (resolved?.customer_tier as string) ?? null,
    recent_runs: Array.isArray(resolved?.recent_runs)
      ? (resolved.recent_runs as FlowContext["recent_runs"])
      : [],
  };
}

async function executeRun(
  admin: SupabaseClient,
  def: FlowWorkflowDefinition & { id: string },
  event: FlowEvent,
): Promise<{ status: string; runId: string; deadLettered: boolean }> {
  const replay = await resolveReplayContext(admin, event, def.slug);
  const runStart = Date.now();
  const { data: runRow, error: runErr } = await admin.from("flow_workflow_runs").insert({
    workspace_id: event.workspace_id,
    workflow_id: def.id,
    workflow_slug: def.slug,
    event_id: event.event_id,
    status: "running",
    dry_run: def.dry_run ?? false,
    metadata: { trigger_pattern: def.trigger_event_pattern, effect_event_id: replay.effectEventId },
  }).select("id").maybeSingle();

  if (runErr || !runRow) {
    console.error("[flow-runner] failed to create run row:", runErr);
    return { status: "failed", runId: "", deadLettered: false };
  }

  const runId = runRow.id as string;
  const context = await buildContextFromEvent(admin, event);
  context.event = { ...event, event_id: replay.effectEventId };

  await admin.from("flow_workflow_runs").update({
    resolved_context: {
      company: context.company,
      deal: context.deal,
      health_score: context.health_score,
      ar_block_status: context.ar_block_status,
      customer_tier: context.customer_tier,
    },
  }).eq("id", runId);

  try {
    await admin.from("analytics_action_log").insert({
      workspace_id: event.workspace_id,
      action_type: "flow_run_start",
      source_widget: "flow-runner",
      metadata: { run_id: runId, workflow_slug: def.slug, event_id: event.event_id },
    });
  } catch { /* swallow */ }

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

  let allSucceeded = true;
  let anyFailed = false;
  let deadLettered = false;

  const retryPolicy = (def as { retry_policy?: { max?: number; backoff?: string; base_seconds?: number } }).retry_policy ?? {};
  const maxAttempts = Math.max(1, Number(retryPolicy.max ?? 3));
  const baseDelaySeconds = Number(retryPolicy.base_seconds ?? 30);

  for (let i = 0; i < (def.actions ?? []).length; i++) {
    const step = def.actions[i];
    const stepStart = Date.now();

    const { data: stepRow } = await admin.from("flow_workflow_run_steps").insert({
      run_id: runId,
      step_index: i,
      step_type: "action",
      action_key: step.action_key,
      params: step.params,
      status: "pending",
      started_at: new Date(stepStart).toISOString(),
    }).select("id").maybeSingle();
    const stepId = stepRow?.id as string | undefined;

    let action;
    try {
      action = getAction(step.action_key);
    } catch (err) {
      await admin.from("flow_workflow_run_steps").update({
        status: "skipped",
        error_text: (err as Error).message,
        finished_at: new Date().toISOString(),
      }).eq("id", stepId ?? "");
      continue;
    }

    const resolvedParams = resolveParamsForRun(step.params, context);
    const idempotencyKey = computeIdempotencyKey(action.idempotency_key_template, context, resolvedParams);

    const priorStep = completedReplayStep(replay.priorSteps, i, step.action_key, step.params);
    if (priorStep) {
      const { error: receiptError } = await admin.from("flow_workflow_run_steps").update({
        idempotency_key: idempotencyKey, status: "skipped",
        result: { ...priorStep.result, idempotency_hit: true, replay_receipt: true },
        finished_at: new Date().toISOString(),
      }).eq("id", stepId ?? "");
      if (receiptError) throw new Error("Replay step receipt could not be persisted");
      continue;
    }

    const { data: priorResult } = await admin
      .from("flow_action_idempotency")
      .select("result")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (priorResult?.result) {
      await admin.from("flow_workflow_run_steps").update({
        idempotency_key: idempotencyKey,
        status: "skipped",
        result: { ...priorResult.result, idempotency_hit: true },
        finished_at: new Date().toISOString(),
      }).eq("id", stepId ?? "");
      continue;
    }

    let result: FlowActionResult = { status: "failed", error: "no_attempt", retryable: true };
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        result = await action.execute(resolvedParams, context, {
          admin,
          workspace_id: event.workspace_id,
          run_id: runId,
          step_index: i,
          step_id: stepId,
          dry_run: def.dry_run ?? false,
        } as never);
      } catch (err) {
        result = { status: "failed", error: (err as Error).message, retryable: false };
      }

      if (result.status !== "failed") break;
      if (!result.retryable) break;
      if (attempt >= maxAttempts) break;

      await admin.from("flow_workflow_run_steps").update({
        status: "retrying",
        error_text: `attempt ${attempt}/${maxAttempts}: ${result.error}`,
      }).eq("id", stepId ?? "");

      const backoffSeconds = retryPolicy.backoff === "exponential"
        ? baseDelaySeconds * Math.pow(2, attempt - 1)
        : baseDelaySeconds;
      const cappedDelay = Math.min(backoffSeconds * 1000, 5000);
      await new Promise((r) => setTimeout(r, cappedDelay));
    }

    await admin.from("flow_workflow_run_steps").update({
      idempotency_key: idempotencyKey,
      status: result.status === "succeeded" ? "succeeded" : result.status === "skipped" ? "skipped" : "failed",
      result: result.status !== "failed" ? (result as { result?: Record<string, unknown> }).result ?? null : null,
      error_text: result.status === "failed" ? result.error : null,
      finished_at: new Date().toISOString(),
    }).eq("id", stepId ?? "");

    if (result.status === "succeeded" && !def.dry_run) {
      try {
        await admin.from("flow_action_idempotency").insert({
          idempotency_key: idempotencyKey,
          workspace_id: event.workspace_id,
          run_id: runId,
          action_key: step.action_key,
          result: (result as { result: Record<string, unknown> }).result,
        });
      } catch { /* race-safe */ }
    }

    if (result.status === "failed") {
      anyFailed = true;
      allSucceeded = false;
      if (step.on_failure === "abort" || !step.on_failure) {
        await admin.rpc("enqueue_workflow_dead_letter", {
          p_run_id: runId,
          p_workflow_slug: def.slug,
          p_reason: result.error,
          p_failed_step: step.action_key,
          p_payload: { event_id: event.event_id, step_index: i, attempts: attempt },
        });
        deadLettered = true;
        break;
      }
    }
  }

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

async function syncRegisteredWorkflows(admin: SupabaseClient): Promise<void> {
  for (const wf of REGISTERED_WORKFLOWS) {
    try {
      const hash = await sha256(JSON.stringify({
        p: wf.trigger_event_pattern,
        c: wf.conditions,
        a: wf.actions,
        s: wf.surface,
        im: wf.iron_metadata,
        ff: wf.feature_flag,
        uh: wf.undo_handler,
      }));
      const { data: existing } = await admin
        .from("flow_workflow_definitions")
        .select("id, definition_hash, enabled, dry_run")
        .eq("workspace_id", "default")
        .eq("slug", wf.slug)
        .maybeSingle();
      if (!existing) {
        await admin.from("flow_workflow_definitions").insert({
          workspace_id: "default",
          slug: wf.slug,
          name: wf.name,
          description: wf.description,
          owner_role: wf.owner_role,
          trigger_event_pattern: wf.trigger_event_pattern,
          condition_dsl: wf.conditions,
          action_chain: wf.actions,
          affects_modules: wf.affects_modules,
          enabled: wf.enabled !== false,
          dry_run: wf.dry_run ?? false,
          definition_hash: hash,
          surface: wf.surface ?? "automated",
          iron_metadata: wf.iron_metadata ?? null,
          feature_flag: wf.feature_flag ?? null,
          undo_handler: wf.undo_handler ?? null,
          undo_semantic_rule: wf.undo_semantic_rule ?? null,
          high_value_threshold_cents: wf.high_value_threshold_cents ?? null,
          roles_allowed: wf.roles_allowed ?? null,
        });
      } else if (existing.definition_hash !== hash) {
        await admin.from("flow_workflow_definitions").update({
          name: wf.name,
          description: wf.description,
          owner_role: wf.owner_role,
          trigger_event_pattern: wf.trigger_event_pattern,
          condition_dsl: wf.conditions,
          action_chain: wf.actions,
          affects_modules: wf.affects_modules,
          definition_hash: hash,
          version: 1,
          surface: wf.surface ?? "automated",
          iron_metadata: wf.iron_metadata ?? null,
          feature_flag: wf.feature_flag ?? null,
          undo_handler: wf.undo_handler ?? null,
          undo_semantic_rule: wf.undo_semantic_rule ?? null,
          high_value_threshold_cents: wf.high_value_threshold_cents ?? null,
          roles_allowed: wf.roles_allowed ?? null,
        }).eq("id", existing.id);
      }
    } catch (err) {
      console.warn(`[flow-runner] sync failed for ${wf.slug}:`, (err as Error).message);
    }
  }
}

export async function runFlowRunnerTick(
  admin: SupabaseClient,
  workspaceScope: FlowRunnerWorkspaceScope,
): Promise<RunnerResult> {
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

  await syncRegisteredWorkflows(admin);

  let defsQuery = admin
    .from("flow_workflow_definitions")
    .select("id, slug, name, owner_role, trigger_event_pattern, condition_dsl, action_chain, retry_policy, dry_run, enabled, affects_modules")
    .eq("enabled", true);

  if (workspaceScope.mode === "scoped") {
    defsQuery = defsQuery.or(
      `workspace_id.eq.${workspaceScope.workspaceId},workspace_id.eq.default`,
    );
  }

  const { data: defs, error: defsErr } = await defsQuery;
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

  let eventsQuery = admin
    .from("flow_pending_events")
    .select("event_id, flow_event_type, source_module, workspace_id, entity_type, entity_id, occurred_at, properties, correlation_id, parent_event_id, consumed_by_runs")
    .order("occurred_at", { ascending: true })
    .limit(POLL_BATCH_SIZE);

  if (workspaceScope.mode === "scoped") {
    eventsQuery = eventsQuery.eq("workspace_id", workspaceScope.workspaceId);
  }

  const { data: events, error: eventsErr } = await eventsQuery;
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

    const matched = definitions.filter((d) => workflowMatchesEvent(d, event));
    if (event.properties.resumed_from_run && matched.length === 0) throw new Error("The replay workflow is unavailable; the event remains pending");
    result.workflows_evaluated += matched.length;

    if (matched.length === 0) {
      await admin.rpc("mark_event_consumed", {
        p_event_id: event.event_id,
        p_run_id: "00000000-0000-0000-0000-000000000000",
      });
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
  return result;
}

async function readBody(req: Request): Promise<RequestBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as RequestBody;
}

export interface FlowRunnerDependencies {
  createAdminClient: typeof createAdminClient;
  authenticateFlowRunner: typeof authenticateFlowRunner;
  runFlowRunnerTick: typeof runFlowRunnerTick;
}

const defaultDependencies: FlowRunnerDependencies = {
  createAdminClient,
  authenticateFlowRunner,
  runFlowRunnerTick,
};

export async function handleFlowRunner(
  req: Request,
  overrides: Partial<FlowRunnerDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  const ch = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: ch });
  }

  const admin = dependencies.createAdminClient();
  const auth = await dependencies.authenticateFlowRunner(req, admin);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: auth.status,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await readBody(req);
    const requestedWorkspaceId = normalizeWorkspaceId(body.workspace) ??
      normalizeWorkspaceId(body.workspace_id);

    const workspaceScope = resolveFlowRunnerWorkspaceScope({
      isServiceRole: auth.isServiceRole,
      authWorkspaceId: auth.isServiceRole ? null : auth.workspaceId,
      requestedWorkspaceId,
      headerWorkspaceId: auth.isServiceRole ? auth.headerWorkspaceId : null,
    });

    if (!auth.isServiceRole && workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const tickStart = Date.now();
    const result = await dependencies.runFlowRunnerTick(admin, workspaceScope);

    try {
      await admin.from("service_cron_runs").insert({
        workspace_id: workspaceScope.mode === "scoped"
          ? workspaceScope.workspaceId
          : "default",
        job_name: "flow-runner",
        started_at: new Date(tickStart).toISOString(),
        finished_at: new Date().toISOString(),
        ok: true,
        metadata: {
          ...result,
          registry_size: Object.keys(ACTION_REGISTRY).length,
          workspace_scope: workspaceScope.mode,
        },
      });
    } catch { /* swallow */ }

    return new Response(JSON.stringify({
      ok: true,
      workspace_scope: workspaceScope.mode,
      workspace_id: workspaceScope.mode === "scoped" ? workspaceScope.workspaceId : null,
      ...result,
    }), {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }
    console.error("[flow-runner] fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
}
