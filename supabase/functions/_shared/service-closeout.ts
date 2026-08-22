/**
 * Service RO closeout — finalize invoice, notify customer, queue warranty,
 * and sync AR when a service writer/cashier closes a repair order.
 *
 * Operating role: service writer / cashier closing the RO.
 * Dealership workflow: job done → RO closed → bill in customer's hands →
 * warranty in the claim pile → AR visible on the next lot visit.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { generateInvoiceForServiceJob } from "./service-invoice.ts";
import { queueServiceCustomerNotification } from "./service-customer-notification-queue.ts";
import {
  assembleWarrantyClaimForJob,
  jobHasWarrantyClaimLines,
} from "./service-warranty-assembler.ts";

export type ServiceCloseoutStage = "invoiced" | "paid_closed";

export interface ServiceCloseoutResult {
  invoice_id: string | null;
  invoice_finalized: boolean;
  warranty_claim_id: string | null;
  warranty_queued: boolean;
  ar_synced: boolean;
  warnings: string[];
}

const FINALIZED_INVOICE_STATUSES = new Set([
  "sent",
  "viewed",
  "partial",
  "overdue",
  "paid",
]);

export async function finalizeServiceInvoiceForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ invoice_id: string | null; finalized: boolean; error?: string }> {
  const generated = await generateInvoiceForServiceJob(supabase, jobId);
  if (!generated.invoice_id && generated.error) {
    return { invoice_id: null, finalized: false, error: generated.error };
  }

  const invoiceId = generated.invoice_id;
  if (!invoiceId) {
    return {
      invoice_id: null,
      finalized: false,
      error: generated.error ?? "no customer invoice for this job",
    };
  }

  const { data: invoice, error: loadErr } = await supabase
    .from("customer_invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (loadErr || !invoice) {
    return {
      invoice_id: invoiceId,
      finalized: false,
      error: loadErr?.message ?? "invoice load failed",
    };
  }

  const status = String(invoice.status ?? "");
  if (status === "pending") {
    const { error: updErr } = await supabase
      .from("customer_invoices")
      .update({ status: "sent" })
      .eq("id", invoiceId)
      .eq("status", "pending");
    if (updErr) {
      return { invoice_id: invoiceId, finalized: false, error: updErr.message };
    }
    return { invoice_id: invoiceId, finalized: true };
  }

  return {
    invoice_id: invoiceId,
    finalized: FINALIZED_INVOICE_STATUSES.has(status),
  };
}

export async function syncArOpenItemForInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("service_sync_ar_open_item_for_invoice", {
    p_invoice_id: invoiceId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function executeServiceJobCloseout(
  supabase: SupabaseClient,
  params: {
    job: Record<string, unknown>;
    actorId: string;
    stage: ServiceCloseoutStage;
  },
): Promise<ServiceCloseoutResult> {
  const warnings: string[] = [];
  const jobId = params.job.id as string;
  const workspaceId = params.job.workspace_id as string;

  const finalize = await finalizeServiceInvoiceForJob(supabase, jobId);
  if (finalize.error) warnings.push(finalize.error);

  let warrantyClaimId: string | null = null;
  let warrantyQueued = false;
  let arSynced = false;

  if (finalize.invoice_id) {
    const ar = await syncArOpenItemForInvoice(supabase, finalize.invoice_id);
    arSynced = ar.ok;
    if (!ar.ok && ar.error) warnings.push(ar.error);
  }

  if (params.stage === "paid_closed") {
    const eligible = await jobHasWarrantyClaimLines(supabase, jobId);
    if (eligible) {
      const assembled = await assembleWarrantyClaimForJob(supabase, {
        jobId,
        actorId: params.actorId,
        autoQueued: true,
      });
      if (assembled.claim_id) {
        warrantyClaimId = assembled.claim_id;
        warrantyQueued = assembled.created || assembled.updated;
      } else if (assembled.error) {
        warnings.push(assembled.error);
      }
    }
  }

  if (
    finalize.invoice_id &&
    (finalize.finalized || params.stage === "invoiced")
  ) {
    await queueServiceCustomerNotification(supabase, {
      workspaceId,
      jobId,
      advisorId: (params.job.advisor_id as string | null) ?? null,
      notificationType: "invoice_ready",
      stage: params.stage,
      dedupeKey: [
        "service",
        jobId,
        "invoice_sent",
        finalize.invoice_id,
        params.stage,
      ].join(":"),
      metadata: {
        invoice_id: finalize.invoice_id,
        closeout_stage: params.stage,
        auto_closeout: true,
      },
    });
  }

  await supabase.from("service_job_events").insert({
    workspace_id: workspaceId,
    job_id: jobId,
    event_type: params.stage === "paid_closed"
      ? "service_closeout"
      : "service_invoice_sent",
    actor_id: params.actorId,
    metadata: {
      invoice_id: finalize.invoice_id,
      invoice_finalized: finalize.finalized,
      warranty_claim_id: warrantyClaimId,
      warranty_queued: warrantyQueued,
      ar_synced: arSynced,
      warnings,
      stage: params.stage,
    },
  });

  return {
    invoice_id: finalize.invoice_id,
    invoice_finalized: finalize.finalized,
    warranty_claim_id: warrantyClaimId,
    warranty_queued: warrantyQueued,
    ar_synced: arSynced,
    warnings,
  };
}
