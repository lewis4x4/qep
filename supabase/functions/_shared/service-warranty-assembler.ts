/**
 * H8 warranty claim assembly — shared between service-job-router and
 * service closeout (auto-queue draft claims when an RO closes).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function centsFromMoney(value: unknown): number {
  const n = optionalNumber(value) ?? 0;
  return Math.max(0, Math.round(n * 100));
}

async function insertWarrantyClaimEvent(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    claimId: string;
    jobId: string;
    actorId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
) {
  await supabase.from("service_warranty_claim_events").insert({
    workspace_id: params.workspaceId,
    warranty_claim_id: params.claimId,
    service_job_id: params.jobId,
    event_type: params.eventType,
    actor_id: params.actorId,
    metadata: params.metadata ?? {},
  });
}

export async function jobHasWarrantyClaimLines(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data: quoteIds } = await supabase.from("service_quotes").select("id")
    .eq("job_id", jobId);
  const quoteIdList = (quoteIds ?? []).map((q) => q.id as string);
  if (quoteIdList.length > 0) {
    const { count } = await supabase
      .from("service_quote_lines")
      .select("id", { count: "exact", head: true })
      .in("quote_id", quoteIdList)
      .eq("payer_type", "warranty_claim");
    if ((count ?? 0) > 0) return true;
  }

  const { count: laborCount } = await supabase
    .from("service_labor_ledger")
    .select("id", { count: "exact", head: true })
    .eq("service_job_id", jobId)
    .is("deleted_at", null)
    .or("payer_type.eq.warranty_claim,revenue_type.eq.warranty");
  if ((laborCount ?? 0) > 0) return true;

  const { count: billingCount } = await supabase
    .from("service_billing_rows")
    .select("id", { count: "exact", head: true })
    .eq("service_job_id", jobId)
    .is("deleted_at", null)
    .or("payer_type.eq.warranty_claim,revenue_type.eq.warranty");
  if ((billingCount ?? 0) > 0) return true;

  const { count: turnInCount } = await supabase
    .from("service_job_segments")
    .select("id", { count: "exact", head: true })
    .eq("service_job_id", jobId)
    .is("deleted_at", null)
    .eq("warranty_parts_turn_in_required", true);
  return (turnInCount ?? 0) > 0;
}

export interface AssembleWarrantyClaimInput {
  jobId: string;
  actorId: string;
  claimNumber?: string | null;
  oemName?: string | null;
  oemReference?: string | null;
  complaint?: string | null;
  cause?: string | null;
  correction?: string | null;
  metadata?: Record<string, unknown>;
  autoQueued?: boolean;
}

export interface AssembleWarrantyClaimResult {
  claim_id: string | null;
  created: boolean;
  updated: boolean;
  included_line_count: number;
  error?: string;
}

export async function assembleWarrantyClaimForJob(
  supabase: SupabaseClient,
  input: AssembleWarrantyClaimInput,
): Promise<AssembleWarrantyClaimResult> {
  const job_id = input.jobId;

  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select(
      "id, workspace_id, customer_id, machine_id, original_service_job_id, complaint, cause, correction",
    )
    .eq("id", job_id)
    .single();
  if (jErr || !job) {
    return {
      claim_id: null,
      created: false,
      updated: false,
      included_line_count: 0,
      error: "job not found",
    };
  }

  let claim = null as Record<string, unknown> | null;
  let createdClaim = false;

  const { data: existing } = await supabase
    .from("service_warranty_claims")
    .select("*")
    .eq("service_job_id", job_id)
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .maybeSingle();
  claim = existing as Record<string, unknown> | null;

  const claimFields: Record<string, unknown> = {
    workspace_id: job.workspace_id,
    service_job_id: job.id,
    machine_id: job.machine_id,
    customer_id: job.customer_id,
    original_service_job_id: job.original_service_job_id,
    claim_number: input.claimNumber ?? claim?.claim_number ?? null,
    oem_name: input.oemName ?? claim?.oem_name ?? null,
    oem_reference: input.oemReference ?? claim?.oem_reference ?? null,
    complaint: input.complaint ?? job.complaint ?? null,
    cause: input.cause ?? job.cause ?? null,
    correction: input.correction ?? job.correction ?? null,
    updated_by: input.actorId,
    metadata: {
      ...(typeof claim?.metadata === "object" && claim.metadata !== null
        ? claim.metadata as Record<string, unknown>
        : {}),
      ...(input.metadata ?? {}),
      ...(input.autoQueued ? { auto_queued_on_close: true } : {}),
    },
  };

  if (claim?.id) {
    const { data, error } = await supabase
      .from("service_warranty_claims")
      .update(claimFields)
      .eq("id", claim.id as string)
      .select()
      .single();
    if (error) {
      return {
        claim_id: null,
        created: false,
        updated: false,
        included_line_count: 0,
        error: error.message,
      };
    }
    claim = data as Record<string, unknown>;
  } else {
    const { data, error } = await supabase
      .from("service_warranty_claims")
      .insert({ ...claimFields, status: "draft", created_by: input.actorId })
      .select()
      .single();
    if (error) {
      return {
        claim_id: null,
        created: false,
        updated: false,
        included_line_count: 0,
        error: error.message,
      };
    }
    claim = data as Record<string, unknown>;
    createdClaim = true;
  }

  const ws = job.workspace_id as string;
  const claimId = claim.id as string;
  const claimRows: Record<string, unknown>[] = [];

  await supabase
    .from("service_warranty_claim_lines")
    .update({ included: false })
    .eq("warranty_claim_id", claimId);

  const { data: quoteIds } = await supabase.from("service_quotes").select("id")
    .eq("job_id", job_id);
  const quoteIdList = (quoteIds ?? []).map((q) => q.id as string);
  if (quoteIdList.length > 0) {
    const { data: quoteLines } = await supabase
      .from("service_quote_lines")
      .select(
        "id, workspace_id, line_type, description, quantity, extended_price",
      )
      .in("quote_id", quoteIdList)
      .eq("payer_type", "warranty_claim");
    for (const line of quoteLines ?? []) {
      claimRows.push({
        workspace_id: ws,
        warranty_claim_id: claimId,
        service_job_id: job_id,
        service_quote_line_id: line.id,
        source_table: "service_quote_lines",
        source_id: line.id,
        line_type: line.line_type ?? "quote_line",
        description: line.description,
        quantity: line.quantity ?? 1,
        amount_cents: centsFromMoney(line.extended_price),
        cost_cents: 0,
        payer_type: "warranty_claim",
        included: true,
        metadata: { source: "quote_line" },
      });
    }
  }

  const { data: laborRows } = await supabase
    .from("service_labor_ledger")
    .select(
      "id, service_job_segment_id, actual_hours, billable_hours, labor_sale_cents, labor_cost_cents, notes",
    )
    .eq("service_job_id", job_id)
    .is("deleted_at", null)
    .or("payer_type.eq.warranty_claim,revenue_type.eq.warranty");
  for (const row of laborRows ?? []) {
    claimRows.push({
      workspace_id: ws,
      warranty_claim_id: claimId,
      service_job_id: job_id,
      service_job_segment_id: row.service_job_segment_id,
      service_labor_ledger_id: row.id,
      source_table: "service_labor_ledger",
      source_id: row.id,
      line_type: "labor",
      description: row.notes ?? "Warranty labor",
      quantity: row.billable_hours ?? row.actual_hours ?? 1,
      amount_cents: row.labor_sale_cents ?? 0,
      cost_cents: row.labor_cost_cents ?? 0,
      payer_type: "warranty_claim",
      included: true,
      metadata: {
        actual_hours: row.actual_hours,
        billable_hours: row.billable_hours,
      },
    });
  }

  const { data: billingRows } = await supabase
    .from("service_billing_rows")
    .select(
      "id, service_job_segment_id, row_type, description, quantity, extended_price_cents, extended_cost_cents, metadata",
    )
    .eq("service_job_id", job_id)
    .is("deleted_at", null)
    .or("payer_type.eq.warranty_claim,revenue_type.eq.warranty");
  for (const row of billingRows ?? []) {
    claimRows.push({
      workspace_id: ws,
      warranty_claim_id: claimId,
      service_job_id: job_id,
      service_job_segment_id: row.service_job_segment_id,
      service_billing_row_id: row.id,
      source_table: "service_billing_rows",
      source_id: row.id,
      line_type: row.row_type ?? "billing_row",
      description: row.description,
      quantity: row.quantity ?? 1,
      amount_cents: row.extended_price_cents ?? 0,
      cost_cents: row.extended_cost_cents ?? 0,
      payer_type: "warranty_claim",
      included: true,
      metadata: row.metadata ?? {},
    });
  }

  const { data: turnInSegments } = await supabase
    .from("service_job_segments")
    .select(
      "id, segment_number, description, warranty_parts_turn_in_required, warranty_parts_turn_in_completed, warranty_parts_label, warranty_parts_turn_in_completed_at, warranty_parts_turn_in_notes",
    )
    .eq("service_job_id", job_id)
    .is("deleted_at", null)
    .eq("warranty_parts_turn_in_required", true);
  for (const segment of turnInSegments ?? []) {
    claimRows.push({
      workspace_id: ws,
      warranty_claim_id: claimId,
      service_job_id: job_id,
      service_job_segment_id: segment.id,
      source_table: "service_job_segments",
      source_id: segment.id,
      line_type: "warranty_part_turn_in",
      description: segment.description ??
        `Warranty parts turn-in segment ${segment.segment_number}`,
      quantity: 1,
      amount_cents: 0,
      cost_cents: 0,
      payer_type: "warranty_claim",
      included: true,
      metadata: {
        warranty_parts_turn_in_completed:
          segment.warranty_parts_turn_in_completed,
        warranty_parts_label: segment.warranty_parts_label,
        warranty_parts_turn_in_completed_at:
          segment.warranty_parts_turn_in_completed_at,
        warranty_parts_turn_in_notes: segment.warranty_parts_turn_in_notes,
      },
    });
  }

  if (claimRows.length > 0) {
    const { error } = await supabase
      .from("service_warranty_claim_lines")
      .upsert(claimRows, {
        onConflict: "warranty_claim_id,source_table,source_id",
      });
    if (error) {
      return {
        claim_id: claimId,
        created: createdClaim,
        updated: !createdClaim,
        included_line_count: 0,
        error: error.message,
      };
    }

    const quoteLineIds = claimRows.filter((r) =>
      r.source_table === "service_quote_lines"
    ).map((r) => r.source_id as string);
    if (quoteLineIds.length > 0) {
      await supabase.from("service_quote_lines").update({
        warranty_claim_id: claimId,
        payer_type: "warranty_claim",
      }).in("id", quoteLineIds);
    }
    const laborIds = claimRows.filter((r) =>
      r.source_table === "service_labor_ledger"
    ).map((r) => r.source_id as string);
    if (laborIds.length > 0) {
      await supabase.from("service_labor_ledger").update({
        warranty_claim_id: claimId,
        payer_type: "warranty_claim",
        revenue_type: "warranty",
        billing_basis: "warranty",
      }).in("id", laborIds);
    }
    const billingIds = claimRows.filter((r) =>
      r.source_table === "service_billing_rows"
    ).map((r) => r.source_id as string);
    if (billingIds.length > 0) {
      await supabase.from("service_billing_rows").update({
        warranty_claim_id: claimId,
        payer_type: "warranty_claim",
        revenue_type: "warranty",
        billing_basis: "warranty",
      }).in("id", billingIds);
    }
  }

  const requestedAmountCents = claimRows.reduce(
    (sum, row) => sum + Number(row.amount_cents ?? 0),
    0,
  );
  const { error: refreshErr } = await supabase
    .from("service_warranty_claims")
    .update({
      requested_amount_cents: requestedAmountCents,
      updated_by: input.actorId,
    })
    .eq("id", claimId);
  if (refreshErr) {
    return {
      claim_id: claimId,
      created: createdClaim,
      updated: !createdClaim,
      included_line_count: claimRows.length,
      error: refreshErr.message,
    };
  }

  await insertWarrantyClaimEvent(supabase, {
    workspaceId: ws,
    claimId,
    jobId: job_id,
    actorId: input.actorId,
    eventType: input.autoQueued ? "auto_queued_on_close" : "assembled",
    metadata: {
      included_line_count: claimRows.length,
      requested_amount_cents: requestedAmountCents,
      auto_queued_on_close: input.autoQueued ?? false,
    },
  });

  await supabase.from("service_job_events").insert({
    workspace_id: ws,
    job_id,
    event_type: input.autoQueued
      ? "h8_warranty_claim_auto_queued"
      : "h8_warranty_claim_assembled",
    actor_id: input.actorId,
    metadata: {
      warranty_claim_id: claimId,
      included_line_count: claimRows.length,
      requested_amount_cents: requestedAmountCents,
      auto_queued_on_close: input.autoQueued ?? false,
    },
  });

  return {
    claim_id: claimId,
    created: createdClaim,
    updated: !createdClaim,
    included_line_count: claimRows.length,
  };
}
