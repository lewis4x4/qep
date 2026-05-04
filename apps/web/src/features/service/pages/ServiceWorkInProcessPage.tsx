import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart3, ChevronRight, Download, FileStack, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  getServiceWipAgingBucket,
  getServiceWipBillingStatus,
  getServiceWipValue,
  matchesServiceWipFilters,
  normalizeServiceWipJobRows,
  normalizeServiceWipSummaryRows,
  type ServiceWipAgingBucket,
  type ServiceWipBillingStatus,
} from "../lib/service-wip-utils";

type ServiceReportAction = "payroll-csv" | "payroll-print" | "wip-csv" | "wip-print";

const BUCKET_ORDER: ServiceWipAgingBucket[] = ["current", "31_60", "61_90", "91_120", "over_120"];

function bucketLabel(bucket: ServiceWipAgingBucket): string {
  switch (bucket) {
    case "current":
      return "Current";
    case "31_60":
      return "31-60";
    case "61_90":
      return "61-90";
    case "91_120":
      return "91-120";
    case "over_120":
      return "Over 120";
  }
}

function formatMoney(value: number): string {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function functionDataToText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data == null) return "";
  return JSON.stringify(data, null, 2);
}

function downloadTextFile(filename: string, contents: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function printTextReport(title: string, contents: string) {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) {
    throw new Error("Report print window was blocked by the browser.");
  }
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;color:#111827}
h1{font-size:18px;margin:0 0 16px}
pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
@media print{body{margin:0}}
</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(contents)}</pre></body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function ServiceWorkInProcessPage() {
  const [billingStatus, setBillingStatus] = useState<ServiceWipBillingStatus | "all">("all");
  const [agingBucket, setAgingBucket] = useState<ServiceWipAgingBucket | "all">("all");
  const [search, setSearch] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["service-wip-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_work_in_process_summary")
        .select("*");
      if (error) throw error;
      return normalizeServiceWipSummaryRows(data);
    },
  });

  const jobsQuery = useQuery({
    queryKey: ["service-wip-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select("id, workspace_id, customer_id, contact_id, machine_id, source_type, request_type, priority, current_stage, status_flags, branch_id, advisor_id, service_manager_id, technician_id, requested_by_name, customer_problem_summary, ai_diagnosis_summary, selected_job_code_id, haul_required, shop_or_field, scheduled_start_at, scheduled_end_at, quote_total, invoice_total, portal_request_id, fulfillment_run_id, tracking_token, created_at, updated_at, closed_at, deleted_at, customer:crm_companies(id, name), machine:crm_equipment(id, make, model, serial_number, year)")
        .is("closed_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return normalizeServiceWipJobRows(data);
    },
  });

  const filteredJobs = useMemo(() => {
    return (jobsQuery.data ?? []).filter((job) =>
      matchesServiceWipFilters(job, search, billingStatus, agingBucket),
    );
  }, [agingBucket, billingStatus, jobsQuery.data, search]);

  const visibleSummary = useMemo(() => {
    const rows = summaryQuery.data ?? [];
    return rows.filter((row) => {
      if (billingStatus !== "all" && row.billing_status !== billingStatus) return false;
      if (agingBucket !== "all" && row.aging_bucket !== agingBucket) return false;
      return true;
    });
  }, [agingBucket, billingStatus, summaryQuery.data]);

  const totals = useMemo(() => {
    return visibleSummary.reduce(
      (acc, row) => ({
        jobCount: acc.jobCount + row.job_count,
        totalValue: acc.totalValue + Number(row.total_value ?? 0),
      }),
      { jobCount: 0, totalValue: 0 },
    );
  }, [visibleSummary]);

  const bucketRows = useMemo(() => {
    return BUCKET_ORDER.map((bucket) => {
      const rows = visibleSummary.filter((row) => row.aging_bucket === bucket);
      const jobCount = rows.reduce((sum, row) => sum + row.job_count, 0);
      const totalValue = rows.reduce((sum, row) => sum + Number(row.total_value ?? 0), 0);
      return { bucket, jobCount, totalValue };
    });
  }, [visibleSummary]);

  const exportMutation = useMutation({
    mutationFn: async (action: ServiceReportAction) => {
      const today = new Date().toISOString().slice(0, 10);
      const kind = action.startsWith("wip") ? "wip" : "payroll";
      const functionName = kind === "wip" ? "service-wip-report-export" : "service-payroll-report-export";
      const body = kind === "wip"
        ? {
            format: "csv",
            billed_status: billingStatus === "all" ? undefined : billingStatus,
            wip_age_bucket: agingBucket === "all" ? undefined : agingBucket,
          }
        : { format: "csv", summary_by: "detail" };
      const { data, error } = await supabase.functions.invoke<unknown>(functionName, { body });
      if (error) throw error;
      return {
        filename: kind === "wip" ? `service-wip-${today}.csv` : `service-payroll-hours-${today}.csv`,
        print: action.endsWith("print"),
        text: await functionDataToText(data),
      };
    },
    onSuccess: ({ filename, print, text }) => {
      if (print) {
        printTextReport(filename, text);
        setExportMessage(`Opened printable ${filename}.`);
      } else {
        downloadTextFile(filename, text);
        setExportMessage(`Downloaded ${filename}.`);
      }
    },
    onError: (error) => {
      setExportMessage(error instanceof Error ? error.message : "Service export failed.");
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Phase 4 · Work In Process
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              Service WIP analysis
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Aging-bucket analysis for open service jobs with customer / warranty / internal segmentation,
              current value rollups, and drilldown into open work orders. This validates the current service
              stage model against the IntelliDealer Work In Process workflow.
            </p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <FileStack className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Open jobs</p>
            <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{totals.jobCount}</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current value</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{formatMoney(totals.totalValue)}</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Segments</p>
            <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{visibleSummary.length}</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Methods</p>
            <p className="mt-2 text-sm font-semibold text-foreground">Current value</p>
            <p className="mt-1 text-xs text-muted-foreground">Rollup uses invoice total, then quote total fallback.</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border/50 bg-background/70 p-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => exportMutation.mutate("wip-csv")}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            Export WIP CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => exportMutation.mutate("wip-print")}
            disabled={exportMutation.isPending}
          >
            Print WIP report
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => exportMutation.mutate("payroll-csv")}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            Export payroll hours CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => exportMutation.mutate("payroll-print")}
            disabled={exportMutation.isPending}
          >
            Print payroll hours
          </Button>
          <p className="text-xs text-muted-foreground">
            {exportMessage ?? "Exports use the deployed IntelliDealer-compatible WIP and payroll report functions."}
          </p>
        </div>
      </Card>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, machine, serial, branch, stage"
            className="min-w-[280px] rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <select
            value={billingStatus}
            onChange={(e) => setBillingStatus(e.target.value as ServiceWipBillingStatus | "all")}
            className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="customer">Customer</option>
            <option value="warranty">Warranty</option>
            <option value="internal">Internal</option>
          </select>
          <select
            value={agingBucket}
            onChange={(e) => setAgingBucket(e.target.value as ServiceWipAgingBucket | "all")}
            className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          >
            <option value="all">All aging buckets</option>
            {BUCKET_ORDER.map((bucket) => (
              <option key={bucket} value={bucket}>{bucketLabel(bucket)}</option>
            ))}
          </select>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Aging buckets</h2>
          </div>

          <div className="mt-4 space-y-3">
            {bucketRows.map((row) => {
              const percent = totals.jobCount > 0 ? Math.round((row.jobCount / totals.jobCount) * 100) : 0;
              return (
                <button
                  key={row.bucket}
                  type="button"
                  onClick={() => setAgingBucket(row.bucket)}
                  className="w-full rounded-2xl border border-border/60 bg-background/70 p-4 text-left transition hover:border-primary/25"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{bucketLabel(row.bucket)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.jobCount} jobs · {percent}% of visible WIP
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{formatMoney(row.totalValue)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Open work orders</h2>
          </div>

          <div className="mt-4 space-y-3">
            {jobsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading open work orders…</p>
            ) : filteredJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open work orders match the current WIP filters.</p>
            ) : (
              filteredJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/service?job=${encodeURIComponent(job.id)}`}
                  className="block rounded-2xl border border-border/60 bg-background/70 p-4 transition hover:border-primary/25 hover:bg-background"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {job.customer?.name ?? job.requested_by_name ?? "Service job"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {job.machine?.make ?? "Unknown"} {job.machine?.model ?? ""} · {job.machine?.serial_number ?? "No serial"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {job.customer_problem_summary ?? "No summary"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p className="font-semibold text-foreground">{job.current_stage}</p>
                      <p className="mt-1">{getServiceWipBillingStatus(job)}</p>
                      <p className="mt-1">{bucketLabel(getServiceWipAgingBucket(job.created_at))}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-primary">
                        {formatMoney(getServiceWipValue(job))}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
