/**
 * Service Haul Router — Create and sync traffic tickets for service hauls.
 *
 * Auth: user JWT only
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface HaulRequest {
  action: string;
  job_id?: string;
  traffic_ticket_id?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const actorId = auth.userId;

    const body: HaulRequest = await req.json();

    switch (body.action) {
      case "create_haul":
        return await handleCreateHaul(supabase, body, actorId, origin);
      case "sync_status":
        return await handleSyncStatus(supabase, body, origin);
      default:
        return safeJsonError(`Unknown action: ${body.action}`, 400, origin);
    }
  } catch (err) {
    console.error("service-haul-router error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});

async function handleCreateHaul(
  supabase: ReturnType<typeof createClient>,
  body: HaulRequest,
  actorId: string,
  origin: string | null,
) {
  if (!body.job_id) return safeJsonError("job_id required", 400, origin);

  const { data: job } = await supabase
    .from("service_jobs")
    .select(`
      id, workspace_id, branch_id, haul_required,
      machine:crm_equipment(id, serial_number, make, model)
    `)
    .eq("id", body.job_id)
    .single();

  if (!job) return safeJsonError("Job not found", 404, origin);
  if (!job.haul_required) return safeJsonError("Job does not require haul", 400, origin);

  const machine = job.machine as Record<string, unknown> | null;

  const { data: ticket, error } = await supabase
    .from("traffic_tickets")
    .insert({
      workspace_id: job.workspace_id,
      stock_number: (machine?.serial_number as string) ?? "UNKNOWN",
      equipment_id: machine?.id ?? null,
      from_location: "Customer Site",
      to_location: job.branch_id ?? "Shop",
      to_contact_name: "Service Department",
      to_contact_phone: "—",
      shipping_date: new Date().toISOString().slice(0, 10),
      department: "Service",
      billing_comments: `Service haul for job ${body.job_id}`,
      ticket_type: "service",
      status: "haul_pending",
      requested_by: actorId,
    })
    .select()
    .single();

  if (error) {
    console.error("traffic ticket create error:", error);
    return safeJsonError(error.message, 400, origin);
  }

  await supabase
    .from("service_jobs")
    .update({ traffic_ticket_id: ticket.id })
    .eq("id", body.job_id);

  await supabase.from("service_job_events").insert({
    workspace_id: job.workspace_id,
    job_id: body.job_id,
    event_type: "haul_created",
    actor_id: actorId,
    metadata: { traffic_ticket_id: ticket.id },
  });

  return safeJsonOk({ ticket }, origin, 201);
}

async function handleSyncStatus(
  supabase: ReturnType<typeof createClient>,
  body: HaulRequest,
  origin: string | null,
) {
  if (!body.traffic_ticket_id) return safeJsonError("traffic_ticket_id required", 400, origin);

  const { data: ticket } = await supabase
    .from("traffic_tickets")
    .select("id, status, billing_comments")
    .eq("id", body.traffic_ticket_id)
    .single();

  if (!ticket) return safeJsonError("Traffic ticket not found", 404, origin);

  let { data: job } = await supabase
    .from("service_jobs")
    .select("id, current_stage, workspace_id")
    .eq("traffic_ticket_id", body.traffic_ticket_id)
    .maybeSingle();

  if (!job) {
    const jobIdMatch = ticket.billing_comments?.match(/job ([0-9a-f-]{36})/i);
    if (!jobIdMatch) {
      return safeJsonOk({ synced: false, reason: "no linked job" }, origin);
    }
    const { data: legacyJob } = await supabase
      .from("service_jobs")
      .select("id, current_stage, workspace_id")
      .eq("id", jobIdMatch[1])
      .single();
    job = legacyJob ?? null;
  }

  if (!job) return safeJsonOk({ synced: false, reason: "linked job not found" }, origin);

  const jobId = job.id;

  if (ticket.status === "completed" && job.current_stage === "haul_scheduled") {
    await supabase
      .from("service_jobs")
      .update({ current_stage: "scheduled" })
      .eq("id", jobId);

    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: jobId,
      event_type: "stage_transition",
      old_stage: "haul_scheduled",
      new_stage: "scheduled",
      metadata: { trigger: "haul_completed", traffic_ticket_id: ticket.id },
    });

    return safeJsonOk({ synced: true, advanced_to: "scheduled" }, origin);
  }

  if ((ticket.status === "scheduled" || ticket.status === "being_shipped") &&
    job.current_stage !== "haul_scheduled" &&
    job.current_stage === "parts_staged") {
    await supabase
      .from("service_jobs")
      .update({ current_stage: "haul_scheduled" })
      .eq("id", jobId);

    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: jobId,
      event_type: "stage_transition",
      old_stage: "parts_staged",
      new_stage: "haul_scheduled",
      metadata: { trigger: "haul_scheduled", traffic_ticket_id: ticket.id },
    });

    return safeJsonOk({ synced: true, advanced_to: "haul_scheduled" }, origin);
  }

  return safeJsonOk({ synced: false, reason: "no state change needed" }, origin);
}
