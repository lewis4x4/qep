/**
 * Service Job Router — CRUD + lifecycle transitions for service_jobs.
 *
 * Auth: user JWT only (service_role rejected — use RLS via user session).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  safeJsonError,
  safeJsonOk,
  optionsResponse,
} from "../_shared/safe-cors.ts";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  request_received: ["triaging"],
  triaging: ["diagnosis_selected"],
  diagnosis_selected: ["quote_drafted"],
  quote_drafted: ["quote_sent"],
  quote_sent: ["approved", "quote_drafted"],
  approved: ["parts_pending"],
  parts_pending: ["parts_staged"],
  parts_staged: ["scheduled", "haul_scheduled"],
  haul_scheduled: ["scheduled"],
  scheduled: ["in_progress"],
  in_progress: ["blocked_waiting", "quality_check"],
  blocked_waiting: ["in_progress"],
  quality_check: ["ready_for_pickup"],
  ready_for_pickup: ["invoice_ready"],
  invoice_ready: ["invoiced"],
  invoiced: ["paid_closed"],
};

const BLOCKED_ALLOWED_FROM = new Set([
  "parts_pending",
  "parts_staged",
  "haul_scheduled",
  "scheduled",
  "in_progress",
]);

const ALLOWED_UPDATE_FIELDS = new Set([
  "customer_id",
  "contact_id",
  "machine_id",
  "source_type",
  "request_type",
  "priority",
  "status_flags",
  "branch_id",
  "advisor_id",
  "service_manager_id",
  "technician_id",
  "requested_by_name",
  "customer_problem_summary",
  "ai_diagnosis_summary",
  "selected_job_code_id",
  "haul_required",
  "shop_or_field",
  "scheduled_start_at",
  "scheduled_end_at",
  "quote_total",
  "invoice_total",
]);

interface RouterPayload {
  action: string;
  [key: string]: unknown;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const actorId = auth.userId;

    const body: RouterPayload = await req.json();
    const { action } = body;

    switch (action) {
      case "create":
        return await handleCreate(supabase, body, actorId, origin);
      case "update":
        return await handleUpdate(supabase, body, actorId, origin);
      case "transition":
        return await handleTransition(supabase, body, actorId, origin);
      case "get":
        return await handleGet(supabase, body, origin);
      case "list":
        return await handleList(supabase, body, origin);
      default:
        return safeJsonError(`Unknown action: ${action}`, 400, origin);
    }
  } catch (err) {
    console.error("service-job-router error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});

async function handleCreate(
  supabase: ReturnType<typeof createClient>,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const {
    customer_id,
    contact_id,
    machine_id,
    source_type = "call",
    request_type = "repair",
    priority = "normal",
    status_flags = [],
    branch_id,
    advisor_id,
    service_manager_id,
    requested_by_name,
    customer_problem_summary,
    haul_required = false,
    shop_or_field = "shop",
    scheduled_start_at,
    scheduled_end_at,
  } = body;

  const { data: job, error } = await supabase
    .from("service_jobs")
    .insert({
      customer_id: customer_id || null,
      contact_id: contact_id || null,
      machine_id: machine_id || null,
      source_type,
      request_type,
      priority,
      current_stage: "request_received",
      status_flags,
      branch_id: branch_id || null,
      advisor_id: advisor_id || actorId,
      service_manager_id: service_manager_id || null,
      requested_by_name: requested_by_name || null,
      customer_problem_summary: customer_problem_summary || null,
      haul_required,
      shop_or_field,
      scheduled_start_at: scheduled_start_at || null,
      scheduled_end_at: scheduled_end_at || null,
    })
    .select()
    .single();

  if (error) {
    console.error("create error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "created",
    actor_id: actorId,
    new_stage: "request_received",
    metadata: { source_type, request_type, priority },
  });

  return safeJsonOk({ job }, origin, 201);
}

async function handleUpdate(
  supabase: ReturnType<typeof createClient>,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const { id, ...raw } = body;
  if (!id) return safeJsonError("Missing job id", 400, origin);

  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (key === "action") continue;
    if (ALLOWED_UPDATE_FIELDS.has(key)) {
      fields[key] = raw[key];
    }
  }

  if (Object.keys(fields).length === 0) {
    return safeJsonError("No valid fields to update", 400, origin);
  }

  const { data: job, error } = await supabase
    .from("service_jobs")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("update error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    event_type: "updated",
    actor_id: actorId,
    metadata: { updated_fields: Object.keys(fields) },
  });

  return safeJsonOk({ job }, origin);
}

async function handleTransition(
  supabase: ReturnType<typeof createClient>,
  body: RouterPayload,
  actorId: string,
  origin: string | null,
) {
  const { id, to_stage, blocker_type, blocker_description } = body as {
    id?: string;
    to_stage?: string;
    blocker_type?: string;
    blocker_description?: string;
  };

  if (!id || !to_stage) {
    return safeJsonError("Missing id or to_stage", 400, origin);
  }

  if (to_stage === "blocked_waiting" && (!blocker_type || String(blocker_type).trim() === "")) {
    return safeJsonError(
      "blocker_type is required when moving to blocked_waiting",
      422,
      origin,
    );
  }

  const { data: job, error: fetchErr } = await supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !job) {
    return safeJsonError("Service job not found", 404, origin);
  }

  const fromStage = job.current_stage as string;

  const allowed = ALLOWED_TRANSITIONS[fromStage] ?? [];
  const isBlockTransition = to_stage === "blocked_waiting" && BLOCKED_ALLOWED_FROM.has(fromStage);

  if (!allowed.includes(to_stage) && !isBlockTransition) {
    return safeJsonError(
      `Invalid transition: ${fromStage} -> ${to_stage}`,
      422,
      origin,
    );
  }

  if (to_stage === "blocked_waiting" && blocker_type) {
    await supabase.from("service_job_blockers").insert({
      workspace_id: job.workspace_id,
      job_id: id,
      blocker_type,
      description: blocker_description || null,
      created_by: actorId,
    });
  }

  if (fromStage === "blocked_waiting") {
    await supabase
      .from("service_job_blockers")
      .update({ resolved_at: new Date().toISOString(), resolved_by: actorId })
      .eq("job_id", id)
      .is("resolved_at", null);
  }

  const updates: Record<string, unknown> = { current_stage: to_stage };
  if (to_stage === "paid_closed") {
    updates.closed_at = new Date().toISOString();
  }

  const { data: updated, error: updateErr } = await supabase
    .from("service_jobs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    console.error("transition error:", updateErr);
    return safeJsonError(updateErr.message, 400, origin);
  }

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: id,
    event_type: "stage_transition",
    actor_id: actorId,
    old_stage: fromStage,
    new_stage: to_stage,
    metadata: {
      ...(blocker_type ? { blocker_type, blocker_description } : {}),
    },
  });

  return safeJsonOk({ job: updated }, origin);
}

async function handleGet(
  supabase: ReturnType<typeof createClient>,
  body: RouterPayload,
  origin: string | null,
) {
  const { id } = body;
  if (!id) return safeJsonError("Missing job id", 400, origin);

  const { data: job, error } = await supabase
    .from("service_jobs")
    .select(`
      *,
      customer:crm_companies(id, name),
      contact:crm_contacts(id, first_name, last_name, email, phone),
      machine:crm_equipment(id, make, model, serial_number, year),
      advisor:profiles!service_jobs_advisor_id_fkey(id, full_name, email),
      technician:profiles!service_jobs_technician_id_fkey(id, full_name, email),
      job_code:job_codes(id, job_name, make, model_family, manufacturer_estimated_hours),
      events:service_job_events(id, event_type, actor_id, old_stage, new_stage, metadata, created_at),
      blockers:service_job_blockers(id, blocker_type, description, resolved_at, created_at),
      parts:service_parts_requirements(id, part_number, description, quantity, status, need_by_date),
      quotes:service_quotes(id, version, total, status, sent_at)
    `)
    .eq("id", id)
    .single();

  if (error) {
    console.error("get error:", error);
    return safeJsonError("Service job not found", 404, origin);
  }

  return safeJsonOk({ job }, origin);
}

function sanitizeIlikeTerm(raw: string): string {
  return raw.replace(/[%_\\]/g, "").slice(0, 200);
}

async function handleList(
  supabase: ReturnType<typeof createClient>,
  body: RouterPayload,
  origin: string | null,
) {
  const {
    stage,
    stages,
    priority,
    branch_id,
    advisor_id,
    technician_id,
    status_flag,
    from_date,
    to_date,
    search,
    page = 1,
    per_page = 50,
    include_closed = false,
  } = body as Record<string, unknown>;

  let query = supabase
    .from("service_jobs")
    .select(`
      *,
      customer:crm_companies(id, name),
      machine:crm_equipment(id, make, model, serial_number),
      advisor:profiles!service_jobs_advisor_id_fkey(id, full_name),
      technician:profiles!service_jobs_technician_id_fkey(id, full_name)
    `, { count: "exact" })
    .order("created_at", { ascending: false });

  if (!include_closed) {
    query = query.is("closed_at", null).is("deleted_at", null);
  }

  if (stage) {
    query = query.eq("current_stage", stage as string);
  }
  if (Array.isArray(stages) && stages.length > 0) {
    query = query.in("current_stage", stages as string[]);
  }
  if (priority) {
    query = query.eq("priority", priority as string);
  }
  if (branch_id) {
    query = query.eq("branch_id", branch_id as string);
  }
  if (advisor_id) {
    query = query.eq("advisor_id", advisor_id as string);
  }
  if (technician_id) {
    query = query.eq("technician_id", technician_id as string);
  }
  if (status_flag) {
    query = query.contains("status_flags", [status_flag as string]);
  }
  if (from_date) {
    query = query.gte("created_at", from_date as string);
  }
  if (to_date) {
    query = query.lte("created_at", to_date as string);
  }
  if (search && typeof search === "string") {
    const term = sanitizeIlikeTerm(search);
    if (term.length > 0) {
      const p = `%${term}%`;
      query = query.or(
        `customer_problem_summary.ilike.${p},requested_by_name.ilike.${p}`,
      );
    }
  }

  const pageNum = Math.max(1, Number(page));
  const limit = Math.min(100, Math.max(1, Number(per_page)));
  const from = (pageNum - 1) * limit;
  query = query.range(from, from + limit - 1);

  const { data: jobs, error, count } = await query;

  if (error) {
    console.error("list error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  return safeJsonOk({
    jobs: jobs ?? [],
    total: count ?? 0,
    page: pageNum,
    per_page: limit,
  }, origin);
}
