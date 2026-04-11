import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Award, ArrowUpRight, BookOpen, Brain, Workflow, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { buildLearningLayerBoard } from "../lib/learning-layer";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

export function LearningLayerPage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "learning-layer"],
    queryFn: async () => {
      const [winsResult, lossesResult, runsResult, suggestionsResult, interventionsResult] = await Promise.all([
        supabase
          .from("crm_deals")
          .select("id, name, amount, closed_at, crm_deal_stages!inner(is_closed_won)")
          .eq("crm_deal_stages.is_closed_won", true)
          .not("closed_at", "is", null)
          .gte("closed_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
          .limit(200),
        supabase
          .from("crm_deals")
          .select("id, name, loss_reason, competitor, closed_at, crm_deal_stages!inner(is_closed_lost)")
          .eq("crm_deal_stages.is_closed_lost", true)
          .not("closed_at", "is", null)
          .gte("closed_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
          .limit(200),
        supabase
          .from("flow_workflow_runs")
          .select("workflow_slug, status, duration_ms, started_at")
          .gte("started_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .limit(300),
        supabase
          .from("iron_flow_suggestions")
          .select("id, short_label, occurrence_count, unique_users, status, promoted_flow_id, last_seen_at")
          .in("status", ["open", "promoted"])
          .limit(100),
        supabase
          .from("intervention_memory")
          .select("id, alert_type, resolution_type, resolution_notes, recurrence_count, resolved_at")
          .order("resolved_at", { ascending: false })
          .limit(100),
      ]);

      if (winsResult.error) throw new Error(winsResult.error.message);
      if (lossesResult.error) throw new Error(lossesResult.error.message);
      if (runsResult.error) throw new Error(runsResult.error.message);
      if (suggestionsResult.error) throw new Error(suggestionsResult.error.message);
      if (interventionsResult.error) throw new Error(interventionsResult.error.message);

      return buildLearningLayerBoard({
        wins: (winsResult.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          amount: row.amount,
          closedAt: row.closed_at,
        })),
        losses: (lossesResult.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          lossReason: row.loss_reason,
          competitor: row.competitor,
          closedAt: row.closed_at,
        })),
        workflowRuns: (runsResult.data ?? []).map((row) => ({
          workflowSlug: row.workflow_slug,
          status: row.status,
          durationMs: row.duration_ms,
          startedAt: row.started_at,
        })),
        suggestions: (suggestionsResult.data ?? []).map((row) => ({
          id: row.id,
          shortLabel: row.short_label,
          occurrenceCount: row.occurrence_count,
          uniqueUsers: row.unique_users,
          status: row.status,
          promotedFlowId: row.promoted_flow_id,
          lastSeenAt: row.last_seen_at,
        })),
        interventions: (interventionsResult.data ?? []).map((row) => ({
          id: row.id,
          alertType: row.alert_type,
          resolutionType: row.resolution_type,
          resolutionNotes: row.resolution_notes,
          recurrenceCount: row.recurrence_count,
          resolvedAt: row.resolved_at,
        })),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Learning Layer"
        subtitle="Wins, losses, workflows, and patterns turning into dealership memory."
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading learning layer…</Card>
      ) : boardQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Learning layer is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Award} label="Wins" value={String(board.summary.wins)} />
            <SummaryCard icon={XCircle} label="Losses" value={String(board.summary.losses)} />
            <SummaryCard icon={Workflow} label="Workflows" value={String(board.summary.workflowPatterns)} />
            <SummaryCard icon={Brain} label="Patterns" value={String(board.summary.learnedPatterns)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <LearningColumn title="Wins To Repeat" rows={board.wins} emptyText="No recent closed-won deals are available." />
            <LearningColumn title="Losses To Avoid" rows={board.losses} emptyText="No recent closed-lost patterns are available." />
            <LearningColumn title="Workflow Memory" rows={board.workflows} emptyText="No recent workflow history is available." />
            <LearningColumn title="Learned Patterns" rows={board.patterns} emptyText="No intervention or folk patterns are available." />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Award;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function LearningColumn({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: Array<{
    id?: string;
    key?: string;
    title: string;
    confidence: "high" | "medium" | "low";
    trace: string[];
    href: string;
  }>;
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-qep-orange" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id ?? row.key ?? row.title} className="rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{row.title}</p>
                    <span className={`text-[11px] font-medium ${confidenceTone(row.confidence)}`}>
                      {row.confidence} confidence
                    </span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {row.trace.map((line) => (
                      <p key={line} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={row.href}>
                    Open <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
