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
  | "accept_intake_line"
  | "pick"
  | "receive"
  | "stage"
  | "consume"
  | "return_part";

function intakeLineStatusForSource(source: string | undefined): "suggested" | "accepted" {
  const s = (source ?? "manual").toLowerCase();
  if (s === "ai_suggested" || s === "job_code_template") return "suggested";
  return "accepted";
}

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
  /** Admin/manager/owner only: force pick when ledger would block (audited). */
  override_reason?: string | null;
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
      case "accept_intake_line":
        return await handleAcceptIntakeLine(supabase, body, actorId, origin);
      case "pick":
        return await handleFulfillment(supabase, body, actorId, "pick", "picking", origin, true);
      case "receive":
        return await handleFulfillment(supabase, body, actorId, "receive", "received", origin, false);
      case "stage":
        return await handleStage(supabase, body, actorId, origin);
      case "consume":
        return await handleFulfillment(supabase, body, actorId, "consume", "consumed", origin, false);
      case "return_part":
        return await handleFulfillment(supabase, body, actorId, "return", "returned", origin, false);
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
  const src = body.source ?? "manual";
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
      source: src,
      confidence: "manual",
      status: "pending",
      intake_line_status: intakeLineStatusForSource(src),
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
    const src = String(o.source ?? "manual");
    rows.push({
      workspace_id: job.workspace_id,
      job_id: body.job_id,
      part_number: pn,
      description: o.description ? String(o.description) : null,
      quantity: qty,
      unit_cost: o.unit_cost != null ? Number(o.unit_cost) : null,
      source: src,
      confidence: String(o.confidence ?? "medium"),
      status: "pending",
      intake_line_status: intakeLineStatusForSource(src),
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

async function handleAcceptIntakeLine(
  supabase: SupabaseClient,
  body: Body,
  actorId: string,
  origin: string | null,
) {
  if (!body.requirement_id) return safeJsonError("requirement_id required", 400, origin);

  const { data, error } = await supabase.rpc("service_parts_accept_intake_line", {
    p_requirement_id: body.requirement_id,
    p_actor_id: actorId,
  });

  if (error) {
    const msg = error.message ?? "accept_intake_failed";
    const code = (error as { code?: string }).code;
    const status = code === "42501" || /forbidden/i.test(msg) ? 403 : 400;
    return safeJsonError(msg, status, origin);
  }

  const payload = data as { requirement?: Record<string, unknown>; ok?: boolean } | null;
  return safeJsonOk(payload ?? {}, origin);
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
  _nextStatus: string,
  origin: string | null,
  allowOverride = false,
) {
  if (!body.requirement_id) return safeJsonError("requirement_id required", 400, origin);

  const rpcAction = actionType === "return_part" ? "return" : actionType;
  const rpcArgs: {
    p_requirement_id: string;
    p_action: string;
    p_actor_id: string;
    p_override_reason?: string;
  } = {
    p_requirement_id: body.requirement_id,
    p_action: rpcAction,
    p_actor_id: actorId,
  };
  if (allowOverride) {
    const raw = body.override_reason;
    if (typeof raw === "string" && raw.trim().length > 0) {
      rpcArgs.p_override_reason = raw.trim();
    }
  }

  const { data, error } = await supabase.rpc("service_parts_apply_fulfillment_action", rpcArgs);

  if (error) {
    const msg = error.message ?? "fulfillment_failed";
    const code = (error as { code?: string }).code;
    const status =
      code === "42501" || /forbidden|override_requires_manager/i.test(msg) ? 403 : 400;
    if (/INTAKE_SUGGESTED_NOT_ACCEPTED/i.test(msg)) {
      return safeJsonError(
        "Accept suggested line before pick, receive, consume, or return",
        400,
        origin,
      );
    }
    return safeJsonError(msg, status, origin);
  }

  const payload = data as {
    requirement?: Record<string, unknown>;
    inventory_override?: boolean;
  } | null;
  const updated = payload?.requirement;
  if (!updated || typeof updated !== "object") {
    return safeJsonError("RPC returned no requirement", 500, origin);
  }

  const jobId = String(updated.job_id ?? "");
  const workspaceId = String(updated.workspace_id ?? "");
  const partNumber = String(updated.part_number ?? "").trim();

  await mirrorToFulfillmentRun(supabase, {
    jobId,
    workspaceId,
    eventType: "shop_parts_action",
    payload: {
      action_type: rpcAction,
      requirement_id: body.requirement_id,
      part_number: partNumber,
      inventory_override: payload?.inventory_override === true,
    },
  });

  return safeJsonOk(
    {
      requirement: updated,
      ...(payload?.inventory_override != null
        ? { inventory_override: payload.inventory_override }
        : {}),
    },
    origin,
  );
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
    .select("id, job_id, workspace_id, part_number, intake_line_status")
    .eq("id", body.requirement_id)
    .single();
  if (rErr || !req) return safeJsonError("Requirement not found", 404, origin);
  if ((req as { intake_line_status?: string }).intake_line_status === "suggested") {
    return safeJsonError("Accept suggested line before staging", 400, origin);
  }

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
