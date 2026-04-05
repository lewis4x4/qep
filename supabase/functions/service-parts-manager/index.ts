/**
 * Service Parts Manager — CRUD + fulfillment actions for parts requirements.
 * Keeps service_parts_requirements, service_parts_actions, and service_parts_staging in sync.
 *
 * Auth: user JWT only
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { mirrorToFulfillmentRun } from "../_shared/parts-fulfillment-mirror.ts";

type Action =
  | "add"
  | "update"
  | "remove"
  | "bulk_add"
  | "pick"
  | "receive"
  | "stage"
  | "consume"
  | "return_part";

interface Body {
  action: Action;
  job_id?: string;
  requirement_id?: string;
  part_number?: string;
  description?: string;
  quantity?: number;
  unit_cost?: number | null;
  vendor_id?: string | null;
  source?: string;
  bin_location?: string | null;
  items?: Array<Record<string, unknown>>;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const actorId = auth.userId;

    const body = (await req.json()) as Body;
    const { action } = body;

    switch (action) {
      case "add":
        return await handleAdd(supabase, body, actorId, origin);
      case "update":
        return await handleUpdate(supabase, body, origin);
      case "remove":
        return await handleRemove(supabase, body, actorId, origin);
      case "bulk_add":
        return await handleBulkAdd(supabase, body, actorId, origin);
      case "pick":
        return await handleFulfillment(supabase, body, actorId, "pick", "picking", origin);
      case "receive":
        return await handleFulfillment(supabase, body, actorId, "receive", "received", origin);
      case "stage":
        return await handleStage(supabase, body, actorId, origin);
      case "consume":
        return await handleFulfillment(supabase, body, actorId, "consume", "consumed", origin);
      case "return_part":
        return await handleFulfillment(supabase, body, actorId, "return", "returned", origin);
      default:
        return safeJsonError(`Unknown action: ${action}`, 400, origin);
    }
  } catch (err) {
    console.error("service-parts-manager error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});

async function loadJob(
  supabase: SupabaseClient,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, branch_id")
    .eq("id", jobId)
    .single();
  if (error || !data) return null;
  return data;
}

/** pick/receive/return adjust parts_inventory; consume does not (stock left shelf at pick). */
async function adjustInventoryForAction(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string;
    branchId: string | null;
    partNumber: string;
    quantity: number;
    actionType: string;
    jobId: string;
    actorId: string;
  },
): Promise<void> {
  const { workspaceId, branchId, partNumber, quantity, actionType, jobId, actorId } = opts;
  if (!branchId || quantity <= 0) return;

  let delta = 0;
  if (actionType === "pick") delta = -quantity;
  else if (actionType === "receive" || actionType === "return") delta = quantity;
  else if (actionType === "consume") return;

  if (delta === 0) return;

  const { data, error } = await supabase.rpc("adjust_parts_inventory_delta", {
    p_workspace_id: workspaceId,
    p_branch_id: branchId,
    p_part_number: partNumber,
    p_delta: delta,
  });

  if (error) {
    console.warn("adjust_parts_inventory_delta:", error.message);
    await supabase.from("service_job_events").insert({
      workspace_id: workspaceId,
      job_id: jobId,
      event_type: "parts_inventory_adjust_failed",
      actor_id: actorId,
      metadata: { part_number: partNumber, delta, error: error.message },
    });
    return;
  }

  const row = data as { insufficient?: boolean } | null;
  if (row && typeof row === "object" && row.insufficient) {
    await supabase.from("service_job_events").insert({
      workspace_id: workspaceId,
      job_id: jobId,
      event_type: "parts_inventory_insufficient",
      actor_id: actorId,
      metadata: { part_number: partNumber, delta, note: "qty_on_hand may be understated" },
    });
  }
}

async function logEvent(
  supabase: SupabaseClient,
  workspaceId: string,
  jobId: string,
  actorId: string,
  metadata: Record<string, unknown>,
) {
  await supabase.from("service_job_events").insert({
    workspace_id: workspaceId,
    job_id: jobId,
    event_type: "parts_action",
    actor_id: actorId,
    metadata,
  });
}

async function handleAdd(
  supabase: SupabaseClient,
  body: Body,
  actorId: string,
  origin: string | null,
) {
  if (!body.job_id || !body.part_number) {
    return safeJsonError("job_id and part_number required", 400, origin);
  }
  const job = await loadJob(supabase, body.job_id);
  if (!job) return safeJsonError("Job not found", 404, origin);

  const qty = Math.max(1, Math.floor(Number(body.quantity ?? 1)) || 1);
  const { data: row, error } = await supabase
    .from("service_parts_requirements")
    .insert({
      workspace_id: job.workspace_id,
      job_id: body.job_id,
      part_number: String(body.part_number).trim(),
      description: body.description ?? null,
      quantity: qty,
      unit_cost: body.unit_cost ?? null,
      vendor_id: body.vendor_id ?? null,
      source: body.source ?? "manual",
      confidence: "manual",
      status: "pending",
    })
    .select()
    .single();

  if (error) return safeJsonError(error.message, 400, origin);
  await logEvent(supabase, job.workspace_id, body.job_id, actorId, {
    action: "add",
    requirement_id: row.id,
    part_number: row.part_number,
  });
  return safeJsonOk({ requirement: row }, origin, 201);
}

async function handleUpdate(
  supabase: SupabaseClient,
  body: Body,
  origin: string | null,
) {
  if (!body.requirement_id) return safeJsonError("requirement_id required", 400, origin);
  const fields: Record<string, unknown> = {};
  if (body.part_number != null) fields.part_number = String(body.part_number).trim();
  if (body.description !== undefined) fields.description = body.description;
  if (body.quantity != null) fields.quantity = Math.max(1, Math.floor(Number(body.quantity)) || 1);
  if (body.unit_cost !== undefined) fields.unit_cost = body.unit_cost;
  if (body.vendor_id !== undefined) fields.vendor_id = body.vendor_id;

  const { data: row, error } = await supabase
    .from("service_parts_requirements")
    .update(fields)
    .eq("id", body.requirement_id)
    .select()
    .single();
  if (error) return safeJsonError(error.message, 400, origin);
  return safeJsonOk({ requirement: row }, origin);
}

async function handleRemove(
  supabase: SupabaseClient,
  body: Body,
  actorId: string,
  origin: string | null,
) {
  if (!body.requirement_id) return safeJsonError("requirement_id required", 400, origin);
  const { data: row, error } = await supabase
    .from("service_parts_requirements")
    .update({ status: "cancelled" })
    .eq("id", body.requirement_id)
    .select("job_id, workspace_id")
    .single();
  if (error) return safeJsonError(error.message, 400, origin);
  await logEvent(supabase, row.workspace_id, row.job_id, actorId, {
    action: "remove",
    requirement_id: body.requirement_id,
  });
  return safeJsonOk({ cancelled: true }, origin);
}

async function handleBulkAdd(
  supabase: SupabaseClient,
  body: Body,
  actorId: string,
  origin: string | null,
) {
  if (!body.job_id || !Array.isArray(body.items) || body.items.length === 0) {
    return safeJsonError("job_id and items[] required", 400, origin);
  }
  const job = await loadJob(supabase, body.job_id);
  if (!job) return safeJsonError("Job not found", 404, origin);

  const rows: Record<string, unknown>[] = [];
  for (const item of body.items) {
    const o = item as Record<string, unknown>;
    const pn = String(o.part_number ?? "").trim();
    if (!pn) continue;
    const qty = Math.max(1, Math.floor(Number(o.quantity ?? 1)) || 1);
    rows.push({
      workspace_id: job.workspace_id,
      job_id: body.job_id,
      part_number: pn,
      description: o.description ? String(o.description) : null,
      quantity: qty,
      unit_cost: o.unit_cost != null ? Number(o.unit_cost) : null,
      source: String(o.source ?? "manual"),
      confidence: String(o.confidence ?? "medium"),
      status: "pending",
    });
  }
  if (rows.length === 0) return safeJsonError("No valid items", 400, origin);

  const { data, error } = await supabase.from("service_parts_requirements").insert(rows).select();
  if (error) return safeJsonError(error.message, 400, origin);
  await logEvent(supabase, job.workspace_id, body.job_id, actorId, {
    action: "bulk_add",
    count: rows.length,
  });
  return safeJsonOk({ requirements: data ?? [] }, origin, 201);
}

/** Returns error message or null if allowed. */
function validatePartTransition(
  status: string,
  actionType: string,
): string | null {
  if (actionType === "receive") {
    const ok = ["ordering", "transferring", "received"].includes(status);
    if (!ok) {
      return "INVALID_TRANSITION: receive requires ordering or transferring (planned order in flight)";
    }
  }
  if (actionType === "pick") {
    if (status === "pending") {
      return "INVALID_TRANSITION: pick requires a plan — run parts planner first";
    }
  }
  if (actionType === "consume" || actionType === "return") {
    if (!["staged", "received", "consumed", "returned"].includes(status)) {
      return "INVALID_TRANSITION: line must be staged or received before consume/return";
    }
  }
  return null;
}

async function completeOpenActions(
  supabase: SupabaseClient,
  requirementId: string,
  jobId: string,
) {
  await supabase
    .from("service_parts_actions")
    .update({ completed_at: new Date().toISOString() })
    .eq("requirement_id", requirementId)
    .eq("job_id", jobId)
    .is("completed_at", null)
    .is("superseded_at", null);
}

async function handleFulfillment(
  supabase: SupabaseClient,
  body: Body,
  actorId: string,
  actionType: string,
  nextStatus: string,
  origin: string | null,
) {
  if (!body.requirement_id) return safeJsonError("requirement_id required", 400, origin);

  const { data: req, error: rErr } = await supabase
    .from("service_parts_requirements")
    .select("id, job_id, workspace_id, status, part_number, quantity")
    .eq("id", body.requirement_id)
    .single();
  if (rErr || !req) return safeJsonError("Requirement not found", 404, origin);

  const transitionErr = validatePartTransition(req.status, actionType);
  if (transitionErr) {
    return safeJsonError(transitionErr, 400, origin);
  }

  const jobRow = await loadJob(supabase, req.job_id as string);
  const branchId = jobRow?.branch_id as string | null ?? null;
  const qty = Math.max(1, Math.floor(Number(req.quantity ?? 1)) || 1);
  const partNumber = String(req.part_number ?? "").trim();

  await completeOpenActions(supabase, req.id, req.job_id);

  await supabase.from("service_parts_actions").insert({
    workspace_id: req.workspace_id,
    requirement_id: req.id,
    job_id: req.job_id,
    action_type: actionType,
    actor_id: actorId,
    completed_at: new Date().toISOString(),
    metadata: { via: "service-parts-manager" },
  });

  const { data: updated, error: uErr } = await supabase
    .from("service_parts_requirements")
    .update({ status: nextStatus })
    .eq("id", req.id)
    .select()
    .single();
  if (uErr) return safeJsonError(uErr.message, 400, origin);

  await adjustInventoryForAction(supabase, {
    workspaceId: req.workspace_id as string,
    branchId,
    partNumber,
    quantity: qty,
    actionType,
    jobId: req.job_id as string,
    actorId,
  });

  await logEvent(supabase, req.workspace_id, req.job_id, actorId, {
    action: actionType,
    requirement_id: req.id,
    new_status: nextStatus,
  });

  await mirrorToFulfillmentRun(supabase, {
    jobId: req.job_id as string,
    workspaceId: req.workspace_id as string,
    eventType: "shop_parts_action",
    payload: {
      action_type: actionType,
      requirement_id: req.id,
      part_number: partNumber,
    },
  });

  return safeJsonOk({ requirement: updated }, origin);
}

async function handleStage(
  supabase: SupabaseClient,
  body: Body,
  actorId: string,
  origin: string | null,
) {
  if (!body.requirement_id) return safeJsonError("requirement_id required", 400, origin);

  const { data: req, error: rErr } = await supabase
    .from("service_parts_requirements")
    .select("id, job_id, workspace_id, part_number")
    .eq("id", body.requirement_id)
    .single();
  if (rErr || !req) return safeJsonError("Requirement not found", 404, origin);

  await completeOpenActions(supabase, req.id, req.job_id);

  const bin = body.bin_location?.trim() || "STAGING";
  const partNumber = String(req.part_number ?? "").trim();

  await supabase.from("service_parts_actions").insert({
    workspace_id: req.workspace_id,
    requirement_id: req.id,
    job_id: req.job_id,
    action_type: "stage",
    actor_id: actorId,
    completed_at: new Date().toISOString(),
    metadata: { bin_location: bin },
  });

  await supabase.from("service_parts_staging").insert({
    workspace_id: req.workspace_id,
    requirement_id: req.id,
    job_id: req.job_id,
    bin_location: bin,
    staged_by: actorId,
  });

  const { data: updated, error: uErr } = await supabase
    .from("service_parts_requirements")
    .update({ status: "staged" })
    .eq("id", req.id)
    .select()
    .single();
  if (uErr) return safeJsonError(uErr.message, 400, origin);

  await logEvent(supabase, req.workspace_id, req.job_id, actorId, {
    action: "stage",
    requirement_id: req.id,
    bin_location: bin,
  });

  await mirrorToFulfillmentRun(supabase, {
    jobId: req.job_id as string,
    workspaceId: req.workspace_id as string,
    eventType: "shop_parts_action",
    payload: {
      action_type: "stage",
      requirement_id: req.id,
      part_number: partNumber,
      bin_location: bin,
    },
  });

  return safeJsonOk({ requirement: updated }, origin);
}
