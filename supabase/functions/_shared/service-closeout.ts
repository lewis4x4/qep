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
  financial_complete: boolean;
  financial_errors: string[];
  invoice_not_applicable: boolean;
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
): Promise<{ invoice_id: string | null; finalized: boolean; not_applicable?: boolean; status?: string; error?: string }> {
  const generated = await generateInvoiceForServiceJob(supabase, jobId);
  if (!generated.invoice_id && generated.error) {
    return { invoice_id: null, finalized: false, error: generated.error };
  }

  if (generated.not_applicable) return { invoice_id: null, finalized: false, not_applicable: true };
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
    const { data: sent, error: updErr } = await supabase
      .from("customer_invoices")
      .update({ status: "sent" })
      .eq("id", invoiceId)
      .eq("status", "pending").select("id,status").maybeSingle();
    if (updErr || !sent) {
      return { invoice_id: invoiceId, finalized: false, error: updErr?.message ?? "Invoice changed during finalization; retry" };
    }
    return { invoice_id: invoiceId, finalized: true, status: "sent" };
  }

  return {
    invoice_id: invoiceId,
    finalized: FINALIZED_INVOICE_STATUSES.has(status),
    status,
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

export const defaultServiceCloseoutDependencies = { finalizeServiceInvoiceForJob, syncArOpenItemForInvoice, jobHasWarrantyClaimLines, assembleWarrantyClaimForJob, queueServiceCustomerNotification };

export async function executeServiceJobCloseout(
  supabase: SupabaseClient,
  params: {
    job: Record<string, unknown>;
    actorId: string;
    stage: ServiceCloseoutStage;
  },
  overrides: Partial<typeof defaultServiceCloseoutDependencies> = {},
): Promise<ServiceCloseoutResult> {
  const deps = { ...defaultServiceCloseoutDependencies, ...overrides };
  const warnings: string[] = [];
  const financialErrors: string[] = [];
  const jobId = params.job.id as string;
  const workspaceId = params.job.workspace_id as string;

  const finalize = await deps.finalizeServiceInvoiceForJob(supabase, jobId);
  if (finalize.error) financialErrors.push(finalize.error);
  if (!finalize.not_applicable && !finalize.finalized && !finalize.error) financialErrors.push("Invoice finalization is incomplete");
  if (params.stage === "paid_closed" && finalize.invoice_id && finalize.status !== "paid") financialErrors.push("Customer invoice must be paid before closing this work order");

  let warrantyClaimId: string | null = null;
  let warrantyQueued = false;
  let arSynced = false;

  if (finalize.invoice_id) {
    const ar = await deps.syncArOpenItemForInvoice(supabase, finalize.invoice_id);
    arSynced = ar.ok;
    if (!ar.ok) financialErrors.push(ar.error ?? "AR synchronization failed");
  }

  if (params.stage === "paid_closed") {
    let eligible = false;
    try { eligible = await deps.jobHasWarrantyClaimLines(supabase, jobId); } catch (error) { financialErrors.push(error instanceof Error ? error.message : "Warranty eligibility lookup failed"); }
    if (eligible) {
      const assembled = await deps.assembleWarrantyClaimForJob(supabase, {
        jobId,
        actorId: params.actorId,
        autoQueued: true,
      });
      if (assembled.error) financialErrors.push(assembled.error);
      if (assembled.claim_id && !assembled.error) {
        warrantyClaimId = assembled.claim_id;
        warrantyQueued = assembled.created || assembled.updated;
      } else if (!assembled.error) {
        financialErrors.push("Warranty claim assembly incomplete");
      }
    }
  }

  if (
    financialErrors.length === 0 && finalize.invoice_id &&
    (finalize.finalized || params.stage === "invoiced")
  ) {
    try { await deps.queueServiceCustomerNotification(supabase, {
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
    }); } catch (error) { warnings.push(error instanceof Error ? error.message : "Customer notification remains pending"); }
  }

  await supabase.from("service_job_events").insert({
    workspace_id: workspaceId,
    job_id: jobId,
    event_type: financialErrors.length ? "service_closeout_failed" : "service_closeout_prepared",
    actor_id: params.actorId,
    metadata: {
      invoice_id: finalize.invoice_id,
      invoice_finalized: finalize.finalized,
      warranty_claim_id: warrantyClaimId,
      warranty_queued: warrantyQueued,
      ar_synced: arSynced,
      warnings,
      financial_errors: financialErrors,
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
    financial_complete: financialErrors.length === 0,
    financial_errors: financialErrors,
    invoice_not_applicable: finalize.not_applicable === true,
  };
}

/** Financial preparation must succeed before the job leaves the operator's actionable queue. */
export async function commitServiceCloseoutTransition(
  supabase: SupabaseClient,
  params: { job: Record<string, unknown>; actorId: string; stage: ServiceCloseoutStage; updates: Record<string, unknown> },
  prepare: typeof executeServiceJobCloseout = executeServiceJobCloseout,
): Promise<{ job?: Record<string, unknown>; closeout: ServiceCloseoutResult; error?: string }> {
  const closeout = await prepare(supabase, params);
  if (!closeout.financial_complete) return { closeout, error: closeout.financial_errors.join("; ") };
  const { data, error } = await supabase.from("service_jobs").update(params.updates)
    .eq("id",params.job.id).eq("current_stage",params.job.current_stage).select().single();
  return error || !data ? { closeout, error: error?.message ?? "Job changed during closeout; refresh and retry" } : { job: data, closeout };
}
