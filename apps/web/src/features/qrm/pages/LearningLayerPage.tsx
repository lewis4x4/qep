import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, SignalChip, StatusDot, type StatusTone } from "../components/command-deck";
import { buildLearningLayerBoard } from "../lib/learning-layer";

function confidenceTone(confidence: "high" | "medium" | "low"): StatusTone {
  switch (confidence) {
    case "high":
      return "ok";
    case "medium":
      return "active";
    default:
      return "cool";
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
  const summary = board?.summary ?? {
    wins: 0,
    losses: 0,
    workflowPatterns: 0,
    learnedPatterns: 0,
  };

  // Cascading Iron briefing — route to the sharpest learning lever.
  const learnIronHeadline = boardQuery.isLoading
    ? "Fusing wins, losses, workflows, and intervention memory into dealership learning…"
    : boardQuery.isError
      ? "Learning layer offline — one of the feeders failed. Check the console."
      : summary.learnedPatterns > 0
        ? `${summary.learnedPatterns} pattern${summary.learnedPatterns === 1 ? "" : "s"} surfaced from the field — promote the ones that keep recurring before the knowledge stales.`
        : summary.losses > summary.wins && summary.losses > 0
          ? `${summary.losses} loss${summary.losses === 1 ? "" : "es"} vs ${summary.wins} win${summary.wins === 1 ? "" : "s"} over 90 days — replay the loss reasons and tighten the playbook.`
          : summary.wins > 0
            ? `${summary.wins} win${summary.wins === 1 ? "" : "s"} in 90 days — codify what's working before the motion drifts.`
            : summary.workflowPatterns > 0
              ? `${summary.workflowPatterns} workflow pattern${summary.workflowPatterns === 1 ? "" : "s"} on the board — distill the repeatable ones into SOPs.`
              : "Learning surface is quiet. Run more workflows and log outcomes to fill the memory.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Learning Layer"
        subtitle="Wins, losses, workflows, and patterns turning into dealership memory."
        crumb={{ surface: "PULSE", lens: "LEARNING", count: summary.wins + summary.losses }}
        metrics={[
          { label: "Wins", value: summary.wins, tone: summary.wins > 0 ? "ok" : undefined },
          { label: "Losses", value: summary.losses, tone: summary.losses > 0 ? "warm" : undefined },
          { label: "Workflows", value: summary.workflowPatterns, tone: summary.workflowPatterns > 0 ? "live" : undefined },
          { label: "Patterns", value: summary.learnedPatterns, tone: summary.learnedPatterns > 0 ? "active" : undefined },
        ]}
        ironBriefing={{
          headline: learnIronHeadline,
          actions: [{ label: "SOP + Folk →", href: "/qrm/sop-folk" }],
        }}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading learning layer…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Learning layer is unavailable right now."}
        </DeckSurface>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <LearningColumn title="Wins to repeat" rows={board.wins} emptyText="No recent closed-won deals." tone="ok" />
          <LearningColumn title="Losses to avoid" rows={board.losses} emptyText="No recent closed-lost patterns." tone="warm" />
          <LearningColumn title="Workflow memory" rows={board.workflows} emptyText="No recent workflow history." tone="live" />
          <LearningColumn title="Learned patterns" rows={board.patterns} emptyText="No intervention or folk patterns yet." tone="active" />
        </div>
      )}
    </div>
  );
}

function LearningColumn({
  title,
  rows,
  emptyText,
  tone,
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
  tone: StatusTone;
}) {
  return (
    <DeckSurface className="p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={false} />
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">{title}</h2>
      </div>
      <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.map((row) => {
            const rowTone = confidenceTone(row.confidence);
            return (
              <div key={row.id ?? row.key ?? row.title} className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                  <StatusDot tone={rowTone} pulse={false} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-medium text-foreground">{row.title}</p>
                      <SignalChip label={row.confidence} tone={rowTone} />
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {row.trace.map((line) => (
                        <p key={line} className="text-[11px] text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80 lg:shrink-0">
                  <Link to={row.href}>
                    Open <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            );
          })
        )}
      </div>
    </DeckSurface>
  );
}
