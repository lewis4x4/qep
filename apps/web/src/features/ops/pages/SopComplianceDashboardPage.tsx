import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, CheckCircle, Clock, GitBranch, Loader2, ShieldAlert, TrendingDown, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listSuppressionQueue,
  resolveSuppressionQueueItem,
  type SopSuppressionQueueItem,
} from "../../sop/lib/sop-api";

interface StepAnalysis {
  step_id: string;
  sort_order: number;
  step_title: string;
  completions: number;
  skips: number;
  skip_rate_pct: number;
}

interface ComplianceRow {
  template_id: string;
  template_title: string;
  department: string;
  version: number;
  total_executions: number;
  completed_executions: number;
  abandoned_executions: number;
  blocked_executions: number;
  completion_rate_pct: number | null;
  avg_duration_minutes: number | null;
  step_analysis: StepAnalysis[] | null;
}

export function SopComplianceDashboardPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ops", "sop-compliance"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => { order: (c: string, o: Record<string, boolean>) => Promise<{ data: ComplianceRow[] | null; error: unknown }> };
        };
      })
        .from("sop_compliance_summary")
        .select("*")
        .order("total_executions", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ComplianceRow[];
    },
    staleTime: 60_000,
  });

  const suppressionQuery = useQuery({
    queryKey: ["ops", "sop-suppression-queue"],
    queryFn: async () => {
      const result = await listSuppressionQueue("pending");
      return result.items;
    },
    staleTime: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: (input: { id: string; status: "approved" | "rejected" }) =>
      resolveSuppressionQueueItem(input.id, input.status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops", "sop-suppression-queue"] });
      queryClient.invalidateQueries({ queryKey: ["ops", "sop-compliance"] });
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-2 sm:px-6 lg:px-8 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">SOP Compliance Dashboard</h1>
        <p className="text-sm text-muted-foreground">Completion rates, skip analysis, bottleneck identification per SOP template.</p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-qep-orange" />
              <h2 className="text-sm font-bold text-foreground">Suppression review queue</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Low-confidence SOP mappings waiting on manager review before they count against compliance.
            </p>
          </div>
          <span className="rounded-full bg-qep-orange/10 px-2 py-1 text-[10px] font-semibold text-qep-orange">
            {suppressionQuery.data?.length ?? 0} pending
          </span>
        </div>

        {suppressionQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded bg-muted/20" />)}
          </div>
        ) : suppressionQuery.data && suppressionQuery.data.length > 0 ? (
          <div className="space-y-2">
            {suppressionQuery.data.map((item) => {
              const evidence = item.proposed_evidence ?? {};
              const evidenceUrls = Array.isArray(evidence.evidence_urls)
                ? evidence.evidence_urls.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                : [];
              const resolving = resolveMutation.isPending && resolveMutation.variables?.id === item.id;

              return (
                <Card key={item.id} className="border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                          {item.sop_templates?.department ?? "sop"}
                        </span>
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          {(item.confidence_score * 100).toFixed(0)}% confidence
                        </span>
                        <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400">
                          {item.proposed_state.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {item.sop_templates?.title ?? "SOP template"} · Step {item.sop_steps?.sort_order ?? "?"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.sop_steps?.title ?? "Unknown step"}
                      </p>
                      {item.reason && (
                        <p className="mt-2 text-xs text-foreground">{item.reason}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                        {item.sop_executions?.context_entity_type && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            {item.sop_executions.context_entity_type.replace(/_/g, " ")}
                          </span>
                        )}
                        <span>{new Date(item.created_at).toLocaleString()}</span>
                        {evidenceUrls.length > 0 && <span>{evidenceUrls.length} evidence link{evidenceUrls.length === 1 ? "" : "s"}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolving}
                        onClick={() => resolveMutation.mutate({ id: item.id, status: "rejected" })}
                      >
                        {resolving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <XCircle className="mr-1 h-3 w-3" />}
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={resolving}
                        onClick={() => resolveMutation.mutate({ id: item.id, status: "approved" })}
                      >
                        {resolving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                        Approve
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No low-confidence mappings are waiting on review.</p>
        )}

        {resolveMutation.isError && (
          <p className="text-xs text-red-400">
            {(resolveMutation.error as Error).message}
          </p>
        )}
      </Card>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-32 animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="border-red-500/20 p-4">
          <p className="text-sm text-red-400">Failed to load compliance data.</p>
        </Card>
      )}

      {data && data.length === 0 && (
        <Card className="border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No active SOP templates with execution history yet.</p>
        </Card>
      )}

      {data && data.length > 0 && data.map((row) => {
        const bottleneckStep = (row.step_analysis ?? [])
          .slice()
          .sort((a, b) => b.skip_rate_pct - a.skip_rate_pct)[0];

        const completionRate = row.completion_rate_pct ?? 0;
        const healthColor = completionRate >= 80 ? "text-emerald-400" : completionRate >= 50 ? "text-amber-400" : "text-red-400";

        return (
          <Card key={row.template_id} className="p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">{row.template_title}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {row.department} · v{row.version}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-emerald-400" />
                    <span className="text-muted-foreground">{row.completed_executions} completed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <TrendingDown className="h-3 w-3 text-red-400" />
                    <span className="text-muted-foreground">{row.abandoned_executions} abandoned</span>
                  </div>
                  {row.blocked_executions > 0 && (
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-400" />
                      <span className="text-muted-foreground">{row.blocked_executions} blocked</span>
                    </div>
                  )}
                  {row.avg_duration_minutes !== null && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        avg {Math.round(row.avg_duration_minutes)}m
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className={`text-2xl font-bold ${healthColor}`}>{completionRate.toFixed(0)}%</p>
                <p className="text-[10px] text-muted-foreground">{row.total_executions} total runs</p>
              </div>
            </div>

            {/* Bottleneck callout */}
            {bottleneckStep && bottleneckStep.skip_rate_pct > 20 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Bottleneck: Step {bottleneckStep.sort_order}
                </div>
                <p className="mt-1 text-sm text-foreground">{bottleneckStep.step_title}</p>
                <p className="mt-0.5 text-[11px] text-amber-300">
                  Skipped {bottleneckStep.skip_rate_pct.toFixed(0)}% of the time ({bottleneckStep.skips} skips / {bottleneckStep.completions} completions)
                </p>
              </div>
            )}

            {/* Step analysis table */}
            {row.step_analysis && row.step_analysis.length > 0 && (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Step</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Completed</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Skipped</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Skip Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.step_analysis.map((step) => {
                      const skipColor = step.skip_rate_pct >= 50 ? "text-red-400" :
                                       step.skip_rate_pct >= 20 ? "text-amber-400" :
                                       "text-muted-foreground";
                      return (
                        <tr key={step.step_id} className="border-t border-border/50">
                          <td className="px-2 py-1.5 text-muted-foreground">{step.sort_order}</td>
                          <td className="px-2 py-1.5 text-foreground">{step.step_title}</td>
                          <td className="px-2 py-1.5 text-right text-foreground">{step.completions}</td>
                          <td className="px-2 py-1.5 text-right text-foreground">{step.skips}</td>
                          <td className={`px-2 py-1.5 text-right font-semibold ${skipColor}`}>
                            {step.skip_rate_pct.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
