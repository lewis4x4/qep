import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle, Lightbulb, Loader2, ShieldAlert, Sparkles, Workflow, XCircle, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { listSuppressionQueue, resolveSuppressionQueueItem } from "../../sop/lib/sop-api";
import { summarizeSopFolk } from "../lib/sop-folk";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

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
}

interface IronSuggestionRow {
  id: string;
  pattern_signature: string;
  short_label: string | null;
  intent_examples: Array<{ message?: string }> | null;
  occurrence_count: number;
  unique_users: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  status: string;
  promoted_flow_id: string | null;
}

export function SopFolkWorkflowPage() {
  const queryClient = useQueryClient();

  const complianceQuery = useQuery({
    queryKey: ["qrm", "sop-folk", "compliance"],
    queryFn: async (): Promise<ComplianceRow[]> => {
      const { data, error } = await supabase
        .from("sop_compliance_summary")
        .select("template_id, template_title, department, version, total_executions, completed_executions, abandoned_executions, blocked_executions, completion_rate_pct, avg_duration_minutes")
        .order("total_executions", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ComplianceRow[];
    },
    staleTime: 60_000,
  });

  const suppressionQuery = useQuery({
    queryKey: ["qrm", "sop-folk", "suppression-queue"],
    queryFn: async () => {
      const result = await listSuppressionQueue("pending");
      return result.items;
    },
    staleTime: 30_000,
  });

  const suggestionsQuery = useQuery({
    queryKey: ["qrm", "sop-folk", "iron-flow-suggestions"],
    queryFn: async (): Promise<IronSuggestionRow[]> => {
      const { data, error } = await supabase
        .from("iron_flow_suggestions")
        .select("id, pattern_signature, short_label, intent_examples, occurrence_count, unique_users, first_seen_at, last_seen_at, status, promoted_flow_id")
        .eq("status", "open")
        .order("occurrence_count", { ascending: false })
        .limit(20);
      if (error) return [];
      return (data ?? []) as IronSuggestionRow[];
    },
    staleTime: 60_000,
  });

  const resolveSuppression = useMutation({
    mutationFn: (input: { id: string; status: "approved" | "rejected" }) =>
      resolveSuppressionQueueItem(input.id, input.status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qrm", "sop-folk", "suppression-queue"] });
      queryClient.invalidateQueries({ queryKey: ["qrm", "sop-folk", "compliance"] });
    },
  });

  const runPatternMining = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("iron-pattern-mining", { body: {} });
      if (error) throw new Error(error.message ?? "pattern mining failed");
      if (!(data as { ok?: boolean } | null)?.ok) throw new Error((data as { error?: string } | null)?.error ?? "pattern mining failed");
      return data as { suggestions_upserted?: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qrm", "sop-folk", "iron-flow-suggestions"] });
    },
  });

  const promoteSuggestion = useMutation({
    mutationFn: async (suggestion: IronSuggestionRow) => {
      const exemplar = suggestion.intent_examples?.[0]?.message ?? suggestion.short_label ?? suggestion.pattern_signature;
      const brief = `Pattern observed ${suggestion.occurrence_count} times across ${suggestion.unique_users} user(s): "${exemplar}". Build an Iron-conversational flow that handles this intent.`;
      const { data, error } = await supabase.functions.invoke("flow-synthesize", { body: { brief } });
      const synthData = data as { ok?: boolean; definition_id?: string | null; error?: string } | null;
      if (error) throw new Error(error.message ?? "synth failed");
      if (!synthData?.ok || !synthData.definition_id) throw new Error(synthData?.error ?? "synth failed");
      const { error: updateError } = await supabase
        .from("iron_flow_suggestions")
        .update({
          status: "promoted",
          promoted_flow_id: synthData.definition_id,
          promoted_at: new Date().toISOString(),
        })
        .eq("id", suggestion.id);
      if (updateError) throw new Error(updateError.message);
      return synthData.definition_id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qrm", "sop-folk", "iron-flow-suggestions"] });
    },
  });

  const dismissSuggestion = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await supabase
        .from("iron_flow_suggestions")
        .update({
          status: "dismissed",
          dismissed_at: new Date().toISOString(),
          dismissed_reason: "manager declined from SOP + folk workflow center",
        })
        .eq("id", suggestionId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qrm", "sop-folk", "iron-flow-suggestions"] });
    },
  });

  const summary = useMemo(() => summarizeSopFolk({
    compliance: (complianceQuery.data ?? []).map((row) => ({
      templateId: row.template_id,
      templateTitle: row.template_title,
      department: row.department,
      totalExecutions: row.total_executions,
      blockedExecutions: row.blocked_executions,
      completionRatePct: row.completion_rate_pct,
    })),
    suggestions: (suggestionsQuery.data ?? []).map((row) => ({
      id: row.id,
      occurrenceCount: row.occurrence_count,
      uniqueUsers: row.unique_users,
      status: row.status,
    })),
  }), [complianceQuery.data, suggestionsQuery.data]);

  const isLoading = complianceQuery.isLoading || suppressionQuery.isLoading || suggestionsQuery.isLoading;
  const isError = complianceQuery.isError || suppressionQuery.isError || suggestionsQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="SOP + Folk Workflow Library"
        subtitle="Compliance and folk workflow as two sides of the same operating surface."
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading SOP + folk workflow…</DeckSurface>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          SOP + folk workflow is unavailable right now.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={ShieldAlert} label="Templates" value={String(summary.templates)} />
            <SummaryCard icon={ShieldAlert} label="Weak SOPs" value={String(summary.weakTemplates)} tone={summary.weakTemplates > 0 ? "warn" : "default"} />
            <SummaryCard icon={Workflow} label="Blocked Runs" value={String(summary.blockedRuns)} tone={summary.blockedRuns > 0 ? "warn" : "default"} />
            <SummaryCard icon={Lightbulb} label="Folk Flows" value={String(summary.folkSuggestions)} />
            <SummaryCard icon={Sparkles} label="Usage Hits" value={String(summary.folkUsageHits)} />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">SOP compliance pressure</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Low-completion or blocked templates that need process attention.
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/ops/sop-compliance">
                    SOP dashboard <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
                <AskIronAdvisorButton contextType="sop_compliance" variant="inline" />
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(complianceQuery.data ?? []).slice(0, 10).map((row) => (
                <div key={row.template_id} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{row.template_title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.department} · {row.total_executions} runs · {row.blocked_executions} blocked · completion {(row.completion_rate_pct ?? 0).toFixed(0)}%
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/ops/sop-compliance">
                        Open <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Suppression review</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Low-confidence SOP mappings that still need a human decision.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(suppressionQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No suppression decisions are pending.</p>
              ) : (
                (suppressionQuery.data ?? []).map((item) => {
                  const resolving = resolveSuppression.isPending && resolveSuppression.variables?.id === item.id;
                  return (
                    <div key={item.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <p className="text-sm font-semibold text-foreground">{item.sop_templates?.title ?? "SOP template"} · Step {item.sop_steps?.sort_order ?? "?"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(item.confidence_score * 100).toFixed(0)}% confidence · {item.proposed_state.replace(/_/g, " ")}
                      </p>
                      {item.reason && <p className="mt-2 text-xs text-foreground">{item.reason}</p>}
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" disabled={resolving} onClick={() => resolveSuppression.mutate({ id: item.id, status: "rejected" })}>
                          {resolving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <XCircle className="mr-1 h-3 w-3" />}
                          Reject
                        </Button>
                        <Button size="sm" disabled={resolving} onClick={() => resolveSuppression.mutate({ id: item.id, status: "approved" })}>
                          {resolving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                          Approve
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Folk workflow candidates</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pattern-mined operator requests that suggest a reusable workflow should exist.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={runPatternMining.isPending} onClick={() => runPatternMining.mutate()}>
                  {runPatternMining.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Lightbulb className="mr-1 h-3 w-3" />}
                  Mine patterns
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/flow">
                    Flow admin <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {(suggestionsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No open folk workflow suggestions right now.</p>
              ) : (
                (suggestionsQuery.data ?? []).map((suggestion) => {
                  const promoting = promoteSuggestion.isPending && promoteSuggestion.variables?.id === suggestion.id;
                  const dismissing = dismissSuggestion.isPending && dismissSuggestion.variables === suggestion.id;
                  const exemplar = suggestion.intent_examples?.[0]?.message ?? suggestion.pattern_signature;
                  return (
                    <div key={suggestion.id} className="rounded-xl border border-qep-orange/20 bg-qep-orange/5 p-4">
                      <p className="text-sm font-semibold text-foreground">{suggestion.short_label ?? suggestion.pattern_signature}</p>
                      <p className="mt-1 text-xs italic text-muted-foreground">"{exemplar}"</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {suggestion.occurrence_count} hits · {suggestion.unique_users} users · last seen {suggestion.last_seen_at ? new Date(suggestion.last_seen_at).toLocaleDateString() : "unknown"}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" disabled={promoting} onClick={() => promoteSuggestion.mutate(suggestion)}>
                          {promoting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                          Promote
                        </Button>
                        <Button size="sm" variant="ghost" disabled={dismissing} onClick={() => dismissSuggestion.mutate(suggestion.id)}>
                          {dismissing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <XCircle className="mr-1 h-3 w-3" />}
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className={`mt-3 text-2xl font-semibold ${tone === "warn" ? "text-amber-400" : "text-foreground"}`}>{value}</p>
    </Card>
  );
}
