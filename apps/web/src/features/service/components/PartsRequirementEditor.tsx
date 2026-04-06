import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  acceptPartsIntakeLine,
  invokePartsManager,
  planPartsFulfillment,
  populatePartsFromJobCode,
  postInternalBillingToInvoice,
  resyncPartsFromJobCode,
} from "../lib/api";
import type { ServicePartsRequirement } from "../lib/types";

interface Props {
  jobId: string;
  selectedJobCodeId: string | null;
  /** When provided, shows “Accept all suggested” for P1-C intake gate. */
  parts?: ServicePartsRequirement[] | null;
}

export function PartsRequirementEditor({ jobId, selectedJobCodeId, parts }: Props) {
  const qc = useQueryClient();
  const [partNumber, setPartNumber] = useState("");
  const [qty, setQty] = useState(1);
  const [billingNotice, setBillingNotice] = useState<string | null>(null);
  const [postedInvoiceId, setPostedInvoiceId] = useState<string | null>(null);
  const [acceptNotice, setAcceptNotice] = useState<string | null>(null);

  const addPart = useMutation({
    mutationFn: () =>
      invokePartsManager({
        action: "add",
        job_id: jobId,
        part_number: partNumber,
        quantity: qty,
        source: "manual",
      }),
    onSuccess: () => {
      setPartNumber("");
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const populate = useMutation({
    mutationFn: () => populatePartsFromJobCode(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const plan = useMutation({
    mutationFn: () => planPartsFulfillment(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const resync = useMutation({
    mutationFn: (mode: "replace_cancelled_only" | "full") =>
      resyncPartsFromJobCode(jobId, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const suggestedIds =
    parts?.filter((p) => (p.intake_line_status ?? "accepted") === "suggested").map((p) => p.id) ??
    [];

  const acceptAllSuggested = useMutation({
    mutationFn: async () => {
      if (suggestedIds.length === 0) return { ok: 0, failed: 0 };
      const results = await Promise.allSettled(
        suggestedIds.map((id) => acceptPartsIntakeLine(id)),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0 && ok === 0) {
        const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        const msg =
          first.reason instanceof Error
            ? first.reason.message
            : typeof first.reason === "string"
              ? first.reason
              : "Accept failed";
        throw new Error(`${msg} (${failed} of ${suggestedIds.length})`);
      }
      return { ok, failed };
    },
    onMutate: () => {
      setAcceptNotice(null);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
      if (data && data.failed > 0) {
        setAcceptNotice(
          `Accepted ${data.ok} line(s); ${data.failed} failed — fix or accept those lines individually.`,
        );
      }
    },
  });

  const { data: draftBillingCount = 0 } = useQuery({
    queryKey: ["billing-staging-draft-count", jobId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("service_internal_billing_line_staging")
        .select("id", { count: "exact", head: true })
        .eq("service_job_id", jobId)
        .eq("status", "draft");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: shopInvoiceForJob } = useQuery({
    queryKey: ["shop-invoice-for-job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_invoices")
        .select("id, invoice_number, status")
        .eq("service_job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; invoice_number: string; status: string } | null;
    },
  });

  const postBilling = useMutation({
    mutationFn: () => postInternalBillingToInvoice(jobId),
    onMutate: () => {
      setBillingNotice(null);
      setPostedInvoiceId(null);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["billing-staging-draft-count", jobId] });
      qc.invalidateQueries({ queryKey: ["shop-invoice-for-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
      const d = data as {
        lines_posted?: number;
        invoice_total?: number;
        ok?: boolean;
        customer_invoice_id?: string;
      };
      if (d?.ok === true && (d.lines_posted ?? 0) > 0) {
        setBillingNotice(
          `Posted ${d.lines_posted} line(s) to invoice${
            d.invoice_total != null ? ` — total $${Number(d.invoice_total).toFixed(2)}` : ""
          }.`,
        );
        if (d.customer_invoice_id) setPostedInvoiceId(d.customer_invoice_id);
      }
    },
  });

  return (
    <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Parts Lines</h3>
      <div className="flex flex-wrap gap-2">
        {selectedJobCodeId && (
          <button
            type="button"
            onClick={() => populate.mutate()}
            disabled={populate.isPending}
            className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80"
          >
            {populate.isPending ? "Loading…" : "Load from job code"}
          </button>
        )}
        {suggestedIds.length > 0 && (
          <button
            type="button"
            onClick={() => acceptAllSuggested.mutate()}
            disabled={acceptAllSuggested.isPending}
            className="text-xs px-2 py-1 rounded border border-amber-600/50 text-amber-900 dark:text-amber-200 hover:bg-amber-500/10"
            title="Accept all job-code or AI-suggested lines so planning can run"
          >
            {acceptAllSuggested.isPending ? "Accepting…" : `Accept all suggested (${suggestedIds.length})`}
          </button>
        )}
        <button
          type="button"
          onClick={() => plan.mutate()}
          disabled={plan.isPending}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {plan.isPending ? "Planning…" : "Plan fulfillment"}
        </button>
        <button
          type="button"
          onClick={() => postBilling.mutate()}
          disabled={postBilling.isPending || draftBillingCount === 0}
          title={
            draftBillingCount === 0
              ? "Consume parts first — draft billing lines appear after consume"
              : "Post draft consumed-part lines to a pending customer invoice"
          }
          className="text-xs px-2 py-1 rounded border border-emerald-600/45 text-emerald-900 dark:text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-45 disabled:pointer-events-none"
        >
          {postBilling.isPending
            ? "Posting…"
            : `Post billing${draftBillingCount > 0 ? ` (${draftBillingCount})` : ""}`}
        </button>
        <Link
          to={`/service?job=${encodeURIComponent(jobId)}`}
          className="text-xs px-2 py-1 rounded border border-border text-primary hover:bg-muted/80"
          title="Service command center with this job open"
        >
          Command center
        </Link>
        {(postedInvoiceId || shopInvoiceForJob?.id) && (
          <Link
            to={`/service/invoice/${postedInvoiceId ?? shopInvoiceForJob?.id}`}
            className="text-xs px-2 py-1 rounded border border-border text-primary hover:bg-muted/80"
          >
            View invoice
            {shopInvoiceForJob?.invoice_number ? ` #${shopInvoiceForJob.invoice_number}` : ""}
          </Link>
        )}
        {selectedJobCodeId && (
          <>
            <button
              type="button"
              onClick={() => resync.mutate("replace_cancelled_only")}
              disabled={resync.isPending}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
            >
              {resync.isPending ? "Resync…" : "Resync from job code"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Cancel open lines and re-load full template from job code?")) {
                  resync.mutate("full");
                }
              }}
              disabled={resync.isPending}
              className="text-xs px-2 py-1 rounded border border-amber-600/50 text-amber-900 dark:text-amber-200"
            >
              Full replace
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Part #</label>
          <input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            className="block w-full min-w-[140px] rounded border px-2 py-1 text-sm"
            placeholder="SKU"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Qty</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="block w-20 rounded border px-2 py-1 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => addPart.mutate()}
          disabled={!partNumber.trim() || addPart.isPending}
          className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground"
        >
          Add line
        </button>
      </div>
      {addPart.isError && (
        <p className="text-xs text-destructive">{(addPart.error as Error).message}</p>
      )}
      {acceptAllSuggested.isError && (
        <p className="text-xs text-destructive">{(acceptAllSuggested.error as Error).message}</p>
      )}
      {postBilling.isError && (
        <p className="text-xs text-destructive">{(postBilling.error as Error).message}</p>
      )}
      {acceptNotice && (
        <p className="text-xs text-amber-900 dark:text-amber-200">{acceptNotice}</p>
      )}
      {billingNotice && (
        <p className="text-xs text-emerald-800 dark:text-emerald-300">{billingNotice}</p>
      )}
    </div>
  );
}
