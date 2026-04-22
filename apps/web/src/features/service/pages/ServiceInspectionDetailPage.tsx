import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { useServiceJob, useServiceJobList } from "../hooks/useServiceJobs";
import { groupInspectionFindings, summarizeInspectionFindings } from "../lib/inspectionplus-utils";

type InspectionStatus = "draft" | "in_progress" | "completed" | "cancelled";
type ApprovalStatus = "not_requested" | "pending" | "approved" | "returned";

type InspectionHeader = {
  id: string;
  inspection_number: string;
  title: string;
  template_name: string | null;
  inspection_type: string;
  status: InspectionStatus;
  stock_number: string | null;
  reference_number: string | null;
  customer_name: string | null;
  machine_summary: string | null;
  service_job_id: string | null;
  assignee_name: string | null;
  approver_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  approval_status: ApprovalStatus;
  created_at: string;
  cancellation_reason: string | null;
};

type InspectionFinding = {
  id: string;
  inspection_id: string;
  section_label: string;
  finding_label: string;
  response: "pending" | "pass" | "fail" | "na";
  sort_order: number;
  expected_value: string | null;
  observed_value: string | null;
  notes: string | null;
  requires_follow_up: boolean;
};

const STATUS_STYLES: Record<InspectionStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const RESPONSE_STYLES: Record<InspectionFinding["response"], string> = {
  pending: "border-border/60 bg-background text-muted-foreground",
  pass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  fail: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  na: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export function ServiceInspectionDetailPage() {
  const { inspectionId = "" } = useParams<{ inspectionId: string }>();
  const qc = useQueryClient();

  const inspectionQuery = useQuery({
    queryKey: ["service-inspection", inspectionId],
    enabled: inspectionId.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: InspectionHeader | null; error: unknown }> } };
        };
      })
        .from("service_inspections")
        .select("id, inspection_number, title, template_name, inspection_type, status, stock_number, reference_number, customer_name, machine_summary, service_job_id, assignee_name, approver_name, started_at, completed_at, approval_status, created_at, cancellation_reason")
        .eq("id", inspectionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const findingsQuery = useQuery({
    queryKey: ["service-inspection-findings", inspectionId],
    enabled: inspectionId.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: InspectionFinding[] | null; error: unknown }> } };
        };
      })
        .from("service_inspection_findings")
        .select("id, inspection_id, section_label, finding_label, response, sort_order, expected_value, observed_value, notes, requires_follow_up")
        .eq("inspection_id", inspectionId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: jobsData } = useServiceJobList({
    per_page: 100,
    include_closed: true,
  });
  const linkedJob = useServiceJob(inspectionQuery.data?.service_job_id ?? undefined);

  const header = inspectionQuery.data;
  const findings = findingsQuery.data ?? [];
  const grouped = useMemo(() => groupInspectionFindings(findings), [findings]);
  const progress = useMemo(() => summarizeInspectionFindings(findings), [findings]);

  const saveHeader = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (row: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("service_inspections")
        .update(payload)
        .eq("id", inspectionId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-inspection", inspectionId] });
    },
  });

  const patchFinding = useMutation({
    mutationFn: async ({
      findingId,
      payload,
    }: {
      findingId: string;
      payload: Record<string, unknown>;
    }) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (row: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("service_inspection_findings")
        .update(payload)
        .eq("id", findingId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-inspection-findings", inspectionId] });
    },
  });

  if (!inspectionId) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/service/inspections"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All inspections
        </Link>
      </div>

      {inspectionQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !header ? (
        <Card className="p-4 text-sm text-destructive">Inspection not found.</Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    InspectionPlus form
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{header.title}</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {header.inspection_number} · {header.template_name ?? header.inspection_type}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[header.status]}`}>
                  {header.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <input
                  defaultValue={header.assignee_name ?? ""}
                  onBlur={(e) => {
                    if ((header.assignee_name ?? "") !== e.target.value) {
                      saveHeader.mutate({ assignee_name: e.target.value || null });
                    }
                  }}
                  placeholder="Assignee"
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
                <input
                  defaultValue={header.approver_name ?? ""}
                  onBlur={(e) => {
                    if ((header.approver_name ?? "") !== e.target.value) {
                      saveHeader.mutate({ approver_name: e.target.value || null });
                    }
                  }}
                  placeholder="Approver"
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
                <input
                  defaultValue={header.stock_number ?? ""}
                  onBlur={(e) => {
                    if ((header.stock_number ?? "") !== e.target.value) {
                      saveHeader.mutate({ stock_number: e.target.value || null });
                    }
                  }}
                  placeholder="Stock number"
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
                <input
                  defaultValue={header.reference_number ?? ""}
                  onBlur={(e) => {
                    if ((header.reference_number ?? "") !== e.target.value) {
                      saveHeader.mutate({ reference_number: e.target.value || null });
                    }
                  }}
                  placeholder="Reference number / work order #"
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Progress</p>
                  <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">
                    {progress.completed}/{progress.total}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {progress.failed} failed · {progress.pending} pending
                  </p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linked service</p>
                  {header.service_job_id ? (
                    <Link
                      to={`/service?job=${encodeURIComponent(header.service_job_id)}`}
                      className="mt-2 inline-flex text-sm font-semibold text-primary"
                    >
                      Open linked work order
                    </Link>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No work order linked.</p>
                  )}
                  <select
                    value={header.service_job_id ?? ""}
                    onChange={(e) => {
                      const job = jobsData?.jobs.find((item) => item.id === e.target.value);
                      saveHeader.mutate({
                        service_job_id: e.target.value || null,
                        customer_name: job?.customer?.name ?? null,
                        machine_summary: job?.machine
                          ? `${job.machine.make} ${job.machine.model} · ${job.machine.serial_number}`
                          : null,
                        customer_id: job?.customer?.id ?? null,
                        machine_id: job?.machine?.id ?? null,
                      });
                    }}
                    className="mt-3 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select linked service job</option>
                    {(jobsData?.jobs ?? []).map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.customer?.name ?? "Customer"} · {job.current_stage} · {job.machine?.serial_number ?? job.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {header.status === "draft" ? (
                  <Button
                    onClick={() =>
                      saveHeader.mutate({
                        status: "in_progress",
                        started_at: new Date().toISOString(),
                        approval_status: header.approver_name ? "pending" : "not_requested",
                      })
                    }
                  >
                    Start inspection
                  </Button>
                ) : null}
                {header.status === "in_progress" ? (
                  <Button
                    onClick={() =>
                      saveHeader.mutate({
                        status: "completed",
                        completed_at: new Date().toISOString(),
                        approval_status: header.approver_name ? "pending" : "approved",
                      })
                    }
                  >
                    Complete inspection
                  </Button>
                ) : null}
                {header.status !== "cancelled" && header.status !== "completed" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const reason = window.prompt("Cancellation reason");
                      if (reason === null) return;
                      saveHeader.mutate({
                        status: "cancelled",
                        cancelled_at: new Date().toISOString(),
                        cancellation_reason: reason.trim() || null,
                      });
                    }}
                  >
                    Cancel form
                  </Button>
                ) : null}
              </div>
            </Card>

            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Snapshot
              </p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <p className="font-medium text-foreground">{header.customer_name ?? "No customer linked"}</p>
                  <p className="mt-1 text-muted-foreground">{header.machine_summary ?? "No machine linked"}</p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <p className="text-muted-foreground">Started</p>
                  <p className="mt-1 font-medium text-foreground">{header.started_at ? new Date(header.started_at).toLocaleString() : "Not started"}</p>
                  <p className="mt-3 text-muted-foreground">Completed</p>
                  <p className="mt-1 font-medium text-foreground">{header.completed_at ? new Date(header.completed_at).toLocaleString() : "Open"}</p>
                </div>
                {linkedJob.data ? (
                  <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Linked work order
                    </p>
                    <p className="mt-2 font-medium text-foreground">
                      {linkedJob.data.customer?.name ?? "Customer"} · {linkedJob.data.current_stage}
                    </p>
                    {linkedJob.data.customer_problem_summary ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {linkedJob.data.customer_problem_summary}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {header.cancellation_reason ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-700 dark:text-red-300">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-semibold">Cancellation reason</p>
                        <p className="mt-1">{header.cancellation_reason}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            {grouped.map((section) => (
              <Card key={section.section} className="border border-border/50 bg-card/90 p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  <h2 className="text-lg font-semibold text-foreground">{section.section}</h2>
                </div>

                <div className="mt-4 space-y-3">
                  {section.findings.map((finding) => (
                    <div key={finding.id} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{finding.finding_label}</p>
                          {finding.expected_value ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Expected: {finding.expected_value}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(["pending", "pass", "fail", "na"] as InspectionFinding["response"][]).map((response) => (
                            <button
                              key={response}
                              type="button"
                              onClick={() =>
                                patchFinding.mutate({
                                  findingId: finding.id,
                                  payload: {
                                    response,
                                    requires_follow_up: response === "fail",
                                  },
                                })
                              }
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${RESPONSE_STYLES[response]}`}
                            >
                              {response === "pass" ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Pass
                                </span>
                              ) : response === "fail" ? (
                                <span className="inline-flex items-center gap-1">
                                  <XCircle className="h-3.5 w-3.5" />
                                  Fail
                                </span>
                              ) : response === "na" ? "N/A" : "Pending"}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input
                          defaultValue={finding.observed_value ?? ""}
                          onBlur={(e) => {
                            if ((finding.observed_value ?? "") !== e.target.value) {
                              patchFinding.mutate({
                                findingId: finding.id,
                                payload: { observed_value: e.target.value || null },
                              });
                            }
                          }}
                          placeholder="Observed value"
                          className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                        />
                        <input
                          defaultValue={finding.notes ?? ""}
                          onBlur={(e) => {
                            if ((finding.notes ?? "") !== e.target.value) {
                              patchFinding.mutate({
                                findingId: finding.id,
                                payload: { notes: e.target.value || null },
                              });
                            }
                          }}
                          placeholder="Notes"
                          className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
