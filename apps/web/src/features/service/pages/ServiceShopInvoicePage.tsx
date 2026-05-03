import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { BranchDocumentHeader, BranchDocumentFooter } from "@/components/BranchDocumentHeader";
import { ArrowLeft } from "lucide-react";
import { normalizeShopInvoiceRow, type ShopInvoiceRow } from "../lib/service-page-normalizers";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function useInvoiceBranchSlug(invoice: ShopInvoiceRow | null | undefined) {
  const jobId = invoice?.service_job_id;

  const { data: jobBranch } = useQuery({
    queryKey: ["service-job-branch", jobId],
    enabled: !!jobId && !invoice?.branch_id,
    staleTime: 120_000,
    queryFn: async () => {
      if (!jobId) return null;
      const { data } = await supabase
        .from("service_jobs")
        .select("branch_id")
        .eq("id", jobId)
        .maybeSingle();
      return typeof data?.branch_id === "string" ? data.branch_id : null;
    },
  });

  return invoice?.branch_id ?? jobBranch ?? null;
}

export function ServiceShopInvoicePage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const id = invoiceId?.trim() ?? "";

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["shop-invoice", id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("customer_invoices")
        .select(
          `
          id,
          invoice_number,
          invoice_date,
          due_date,
          description,
          amount,
          tax,
          total,
          status,
          service_job_id,
          crm_company_id,
          branch_id,
          customer_invoice_line_items (
            id,
            line_number,
            description,
            quantity,
            unit_price,
            line_total
          )
        `,
        )
        .eq("id", id)
        .maybeSingle();
      if (qErr) throw qErr;
      return normalizeShopInvoiceRow(data);
    },
    enabled: id.length > 0,
  });

  const branchSlug = useInvoiceBranchSlug(invoice);
  const lines = (invoice?.customer_invoice_line_items ?? []).slice().sort((a, b) => a.line_number - b.line_number);
  const commandCenterHref =
    invoice?.service_job_id != null && invoice.service_job_id.length > 0
      ? `/service?job=${encodeURIComponent(invoice.service_job_id)}`
      : "/service";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Link
            to={commandCenterHref}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to command center
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Shop invoice</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal read-only view. Portal customers see their own invoices under the customer portal.
          </p>
        </div>
        <ServiceSubNav />
      </div>

      {!id && <p className="text-sm text-destructive">Missing invoice id.</p>}

      {isLoading && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Loading…</div>
      )}

      {error && (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      )}

      {!isLoading && !error && invoice && (
        <div className="rounded-xl border bg-card p-4 space-y-4">
          {/* Branch letterhead */}
          <BranchDocumentHeader branchSlug={branchSlug} className="pb-3 border-b" />

          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">#{invoice.invoice_number}</p>
              <p className="text-sm text-muted-foreground">
                {invoice.description ?? "Invoice"} · Due {invoice.due_date}
              </p>
              <span className="inline-block mt-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {invoice.status}
              </span>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-xl font-bold">{money(invoice.total)}</p>
            </div>
          </div>

          {invoice.service_job_id && (
            <p className="text-sm">
              <span className="text-muted-foreground">Service job: </span>
              <Link
                to={commandCenterHref}
                className="text-primary hover:underline font-mono text-xs"
                title="Open this job in the command center"
              >
                {invoice.service_job_id}
              </Link>
            </p>
          )}

          {invoice.crm_company_id && (
            <p className="text-sm">
              <span className="text-muted-foreground">Company: </span>
              <Link
                to={`/crm/companies/${invoice.crm_company_id}`}
                className="text-primary hover:underline"
              >
                Open in QRM
              </Link>
            </p>
          )}

          {lines.length > 0 && (
            <div className="rounded-lg border overflow-hidden text-sm">
              <table className="w-full text-left">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit</th>
                    <th className="px-3 py-2 text-right">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row) => (
                    <tr key={row.id} className="border-t border-border/60">
                      <td className="px-3 py-2 text-muted-foreground">{row.line_number}</td>
                      <td className="px-3 py-2">{row.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {money(row.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Branch document footer */}
          <BranchDocumentFooter branchSlug={branchSlug} />
        </div>
      )}

      {!isLoading && !error && id && !invoice && (
        <p className="text-sm text-muted-foreground">Invoice not found or you do not have access.</p>
      )}
    </div>
  );
}
