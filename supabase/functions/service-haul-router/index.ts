/**
 * Service Haul Router — Create and sync traffic tickets for service hauls.
 *
 * Auth: user JWT only
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  requireServiceUser,
  SERVICE_OPERATIONS_ROLES,
} from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { calculateServiceHaulPricing } from "../_shared/service-haul-pricing.ts";
import { notifyAfterStageChange } from "../_shared/service-lifecycle-notify.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface HaulRequest {
  action: string;
  job_id?: string;
  traffic_ticket_id?: string;
  truck_class?: string;
  mileage_one_way?: number;
  rate_type?: "customer" | "internal";
  from_location?: string;
  to_location?: string;
  to_contact_name?: string;
  to_contact_phone?: string;
  shipping_date?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string;
  driver_id?: string;
  coordinator_id?: string;
  service_advisor_id?: string;
}

type HaulPricingRow = {
  rate_sheet_id: string | null;
  truck_class: string;
  rate_type: "customer" | "internal";
  one_way_miles: number;
  round_trip_miles: number;
  billable_miles: number;
  base_rate_cents: number;
  per_mile_rate_cents: number;
  per_haul_minimum_cents: number;
  total_cents: number;
  rate_source: string;
  calculation: Record<string, unknown>;
};

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeRateType(value: unknown): "customer" | "internal" {
  return value === "internal" ? "internal" : "customer";
}

function normalizePricingRow(
  row: Record<string, unknown> | null | undefined,
): HaulPricingRow | null {
  if (!row) return null;
  const totalCents = Math.round(nonNegativeNumber(row.total_cents));
  return {
    rate_sheet_id: typeof row.rate_sheet_id === "string"
      ? row.rate_sheet_id
      : null,
    truck_class: textValue(row.truck_class, "standard"),
    rate_type: normalizeRateType(row.rate_type),
    one_way_miles: nonNegativeNumber(row.one_way_miles),
    round_trip_miles: nonNegativeNumber(row.round_trip_miles),
    billable_miles: nonNegativeNumber(row.billable_miles),
    base_rate_cents: Math.round(nonNegativeNumber(row.base_rate_cents)),
    per_mile_rate_cents: Math.round(
      nonNegativeNumber(row.per_mile_rate_cents),
    ),
    per_haul_minimum_cents: Math.round(
      nonNegativeNumber(row.per_haul_minimum_cents),
    ),
    total_cents: totalCents,
    rate_source: textValue(row.rate_source, "configured_rate_sheet"),
    calculation: typeof row.calculation === "object" && row.calculation !== null
      ? row.calculation as Record<string, unknown>
      : {},
  };
}

function fallbackHaulPricing(input: {
  truckClass: string;
  rateType: "customer" | "internal";
  oneWayMiles: number;
}): HaulPricingRow {
  const result = calculateServiceHaulPricing({
    oneWayMiles: input.oneWayMiles,
    baseRateCents: 0,
    perMileRateCents: 0,
    perHaulMinimumCents: 50000,
    roundTripMinimumMiles: 0,
  });
  return {
    rate_sheet_id: null,
    truck_class: input.truckClass,
    rate_type: input.rateType,
    one_way_miles: result.oneWayMiles,
    round_trip_miles: result.roundTripMiles,
    billable_miles: result.billableMiles,
    base_rate_cents: 0,
    per_mile_rate_cents: 0,
    per_haul_minimum_cents: 50000,
    total_cents: result.totalCents,
    rate_source: "edge_fallback_legacy_minimum",
    calculation: {
      one_way_miles: result.oneWayMiles,
      round_trip_miles: result.roundTripMiles,
      billable_miles: result.billableMiles,
      base_rate_cents: 0,
      per_mile_rate_cents: 0,
      per_haul_minimum_cents: 50000,
      rate_source: "edge_fallback_legacy_minimum",
    },
  };
}

async function calculateHaulCharge(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    truckClass: string;
    oneWayMiles: number;
    rateType: "customer" | "internal";
  },
): Promise<HaulPricingRow> {
  const { data, error } = await supabase.rpc("service_calculate_haul_charge", {
    p_workspace_id: input.workspaceId,
    p_truck_class: input.truckClass,
    p_mileage_one_way: input.oneWayMiles,
    p_rate_type: input.rateType,
  });
  if (!error) {
    const first = Array.isArray(data) ? data[0] : data;
    const normalized = normalizePricingRow(first as Record<string, unknown>);
    if (normalized) return normalized;
  }
  if (error) {
    console.warn("H7.1 haul pricing RPC unavailable, using fallback:", error);
  }
  return fallbackHaulPricing(input);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
      SERVICE_OPERATIONS_ROLES,
    );
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
    captureEdgeException(err, { fn: "service-haul-router", req });
    console.error("service-haul-router error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("Origin"),
    );
  }
});

async function handleCreateHaul(
  supabase: SupabaseClient,
  body: HaulRequest,
  actorId: string,
  origin: string | null,
) {
  if (!body.job_id) return safeJsonError("job_id required", 400, origin);

  const { data: job } = await supabase
    .from("service_jobs")
    .select(`
      id, workspace_id, branch_id, haul_required, advisor_id, service_manager_id,
      field_site_location, field_site_contact_name, field_site_contact_phone,
      machine:crm_equipment(id, serial_number, make, model)
    `)
    .eq("id", body.job_id)
    .single();

  if (!job) return safeJsonError("Job not found", 404, origin);
  if (!job.haul_required) {
    return safeJsonError("Job does not require haul", 400, origin);
  }

  const embedded = job.machine;
  const machineRow = Array.isArray(embedded) ? embedded[0] : embedded;
  const machine = (machineRow ?? null) as Record<string, unknown> | null;
  const truckClass = textValue(body.truck_class, "standard").toLowerCase();
  const rateType = normalizeRateType(body.rate_type);
  const oneWayMiles = nonNegativeNumber(body.mileage_one_way);
  const pricing = await calculateHaulCharge(supabase, {
    workspaceId: job.workspace_id,
    truckClass,
    oneWayMiles,
    rateType,
  });
  const internalPricing = rateType === "internal"
    ? pricing
    : await calculateHaulCharge(supabase, {
      workspaceId: job.workspace_id,
      truckClass,
      oneWayMiles,
      rateType: "internal",
    });
  const shippingDate = textValue(
    body.shipping_date,
    textValue(body.scheduled_start_at, new Date().toISOString()).slice(0, 10),
  );
  const ticketStatus = body.driver_id || body.scheduled_start_at
    ? "scheduled"
    : "haul_pending";

  const { data: ticket, error } = await supabase
    .from("traffic_tickets")
    .insert({
      workspace_id: job.workspace_id,
      stock_number: (machine?.serial_number as string) ?? "UNKNOWN",
      equipment_id: machine?.id ?? null,
      from_location: textValue(
        body.from_location,
        textValue(job.field_site_location, "Customer Site"),
      ),
      to_location: textValue(body.to_location, job.branch_id ?? "Shop"),
      to_contact_name: textValue(
        body.to_contact_name,
        textValue(job.field_site_contact_name, "Service Department"),
      ),
      to_contact_phone: textValue(
        body.to_contact_phone,
        textValue(job.field_site_contact_phone, "N/A"),
      ),
      shipping_date: shippingDate,
      scheduled_start_at: body.scheduled_start_at ?? null,
      scheduled_end_at: body.scheduled_end_at ?? null,
      department: "service",
      billing_comments: `Service haul for job ${body.job_id}`,
      ticket_type: "service",
      status: ticketStatus,
      requested_by: actorId,
      driver_id: body.driver_id ?? null,
      coordinator_id: body.coordinator_id ?? job.service_manager_id ?? null,
      service_advisor_id: body.service_advisor_id ?? job.advisor_id ?? actorId,
      truck_class: pricing.truck_class,
      mileage_one_way: pricing.one_way_miles,
      round_trip_miles: pricing.round_trip_miles,
      rate_type: pricing.rate_type,
      haul_rate_sheet_id: pricing.rate_sheet_id,
      haul_total_cents: pricing.total_cents,
      haul_cost_cents: internalPricing.total_cents,
      rate_calc: {
        ...pricing.calculation,
        h7_gate: "hauling_transport_dispatch",
        customer_total_cents: pricing.total_cents,
        internal_cost_cents: internalPricing.total_cents,
        internal_rate_source: internalPricing.rate_source,
      },
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
    metadata: {
      traffic_ticket_id: ticket.id,
      truck_class: pricing.truck_class,
      rate_type: pricing.rate_type,
      mileage_one_way: pricing.one_way_miles,
      round_trip_miles: pricing.round_trip_miles,
      haul_total_cents: pricing.total_cents,
      haul_cost_cents: internalPricing.total_cents,
      scheduled_start_at: body.scheduled_start_at ?? null,
      driver_id: body.driver_id ?? null,
    },
  });

  return safeJsonOk(
    { ticket, pricing, internal_pricing: internalPricing },
    origin,
    201,
  );
}

async function handleSyncStatus(
  supabase: SupabaseClient,
  body: HaulRequest,
  origin: string | null,
) {
  if (!body.traffic_ticket_id) {
    return safeJsonError("traffic_ticket_id required", 400, origin);
  }

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

  if (!job) {
    return safeJsonOk(
      { synced: false, reason: "linked job not found" },
      origin,
    );
  }

  const jobId = job.id;

  if (ticket.status === "completed" && job.current_stage === "haul_scheduled") {
    const stageNow = new Date().toISOString();
    await supabase
      .from("service_jobs")
      .update({
        current_stage: "scheduled",
        current_stage_entered_at: stageNow,
      })
      .eq("id", jobId);

    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: jobId,
      event_type: "stage_transition",
      old_stage: "haul_scheduled",
      new_stage: "scheduled",
      metadata: { trigger: "haul_completed", traffic_ticket_id: ticket.id },
    });

    const { data: fullJob } = await supabase.from("service_jobs").select("*")
      .eq("id", jobId).single();
    if (fullJob) {
      await notifyAfterStageChange(
        supabase,
        fullJob as Record<string, unknown>,
        "scheduled",
      );
    }

    return safeJsonOk({ synced: true, advanced_to: "scheduled" }, origin);
  }

  if (
    (ticket.status === "scheduled" || ticket.status === "being_shipped") &&
    job.current_stage !== "haul_scheduled" &&
    job.current_stage === "parts_staged"
  ) {
    const stageNow = new Date().toISOString();
    await supabase
      .from("service_jobs")
      .update({
        current_stage: "haul_scheduled",
        current_stage_entered_at: stageNow,
      })
      .eq("id", jobId);

    await supabase.from("service_job_events").insert({
      workspace_id: job.workspace_id,
      job_id: jobId,
      event_type: "stage_transition",
      old_stage: "parts_staged",
      new_stage: "haul_scheduled",
      metadata: { trigger: "haul_scheduled", traffic_ticket_id: ticket.id },
    });

    const { data: fullJobHaul } = await supabase.from("service_jobs").select(
      "*",
    ).eq("id", jobId).single();
    if (fullJobHaul) {
      await notifyAfterStageChange(
        supabase,
        fullJobHaul as Record<string, unknown>,
        "haul_scheduled",
      );
    }

    return safeJsonOk({ synced: true, advanced_to: "haul_scheduled" }, origin);
  }

  return safeJsonOk(
    { synced: false, reason: "no state change needed" },
    origin,
  );
}
