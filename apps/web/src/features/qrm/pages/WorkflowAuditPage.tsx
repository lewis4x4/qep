import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, type StatusTone } from "../components/command-deck";
import { buildWorkflowAuditBoard } from "../lib/workflow-audit";

export function WorkflowAuditPage() {
  const auditQuery = useQuery({
    queryKey: ["qrm", "workflow-audit"],
    queryFn: async () => {
      const [runsResult, stepsResult, approvalsResult, exceptionsResult, actionsResult] = await Promise.all([
        supabase
          .from("flow_workflow_runs")
          .select("id, workflow_slug, status, started_at, finished_at, error_text, dead_letter_id")
          .order("started_at", { ascending: false })
          .limit(300),
        supabase
          .from("flow_workflow_run_steps")
          .select("run_id, step_index, status, action_key, error_text")
          .order("started_at", { ascending: false })
          .limit(500),
        supabase
          .from("flow_approvals")
          .select("id, run_id, status, requested_at, due_at")
          .in("status", ["pending", "escalated"])
          .limit(300),
        supabase
          .from("exception_queue")
          .select("id, source, status, title, created_at")
          .eq("source", "workflow_dead_letter")
          .in("status", ["open", "in_progress"])
          .limit(300),
        supabase
          .from("analytics_action_log")
          .select("action_type, created_at, metadata")
          .in("action_type", ["workflow_replay", "workflow_override", "approval_decision"])
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

      if (runsResult.error) throw new Error(runsResult.error.message);
      if (stepsResult.error) throw new Error(stepsResult.error.message);
      if (approvalsResult.error) throw new Error(approvalsResult.error.message);
      if (exceptionsResult.error) throw new Error(exceptionsResult.error.message);
      if (actionsResult.error) throw new Error(actionsResult.error.message);

      return buildWorkflowAuditBoard({
        runs: (runsResult.data ?? []).map((row) => ({
          id: row.id,
          workflowSlug: row.workflow_slug,
          status: row.status,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          errorText: row.error_text,
          deadLetterId: row.dead_letter_id,
        })),
        steps: (stepsResult.data ?? []).map((row) => ({
          runId: row.run_id,
          stepIndex: row.step_index,
          status: row.status,
          actionKey: row.action_key,
          errorText: row.error_text,
        })),
        approvals: (approvalsResult.data ?? []).map((row) => ({
          id: row.id,
          runId: row.run_id,
          status: row.status,
          requestedAt: row.requested_at,
          dueAt: row.due_at,
        })),
        exceptions: (exceptionsResult.data ?? []).map((row) => ({
          id: row.id,
          source: row.source,
          status: row.status,
          title: row.title,
          createdAt: row.created_at,
        })),
        actions: (actionsResult.data ?? []).map((row) => ({
          actionType: row.action_type,
          createdAt: row.created_at,
          metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>,
        })),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = auditQuery.data;
  const summary = board?.summary ?? { breaks: 0, stalls: 0, reroutes: 0, silentFails: 0 };
  const total = summary.breaks + summary.stalls + summary.reroutes + summary.silentFails;

  // Cascading Iron briefing — route to the sharpest audit lever.
  const auditIronHeadline = auditQuery.isLoading
    ? "Scanning workflow runs, steps, approvals, exceptions, and action history…"
    : auditQuery.isError
      ? "Workflow Audit offline — one of the feeders failed. Check the console."
      : summary.breaks > 0
        ? `${summary.breaks} dead-lettered or failed run${summary.breaks === 1 ? "" : "s"} — replay before the work disappears. ${summary.stalls} stall${summary.stalls === 1 ? "" : "s"} · ${summary.silentFails} silent fail${summary.silentFails === 1 ? "" : "s"}.`
        : summary.stalls > 0
          ? `${summary.stalls} workflow${summary.stalls === 1 ? "" : "s"} stalled on approvals — decide or escalate before SLAs breach.`
          : summary.silentFails > 0
            ? `${summary.silentFails} workflow exception${summary.silentFails === 1 ? "" : "s"} silently sitting — pull them into the active inbox.`
            : summary.reroutes > 0
              ? `${summary.reroutes} reroute${summary.reroutes === 1 ? "" : "s"} or override${summary.reroutes === 1 ? "" : "s"} logged — review what the system had to route around.`
              : "Workflow system is clean. Motion is stable — keep it there.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Workflow Audit"
        subtitle="Where processes break, stall, reroute, or silently fail across the operating system."
        crumb={{ surface: "PULSE", lens: "AUDIT", count: total }}
        metrics={[
          { label: "Breaks", value: summary.breaks, tone: summary.breaks > 0 ? "hot" : undefined },
          { label: "Stalls", value: summary.stalls, tone: summary.stalls > 0 ? "warm" : undefined },
          { label: "Reroutes", value: summary.reroutes, tone: summary.reroutes > 0 ? "active" : undefined },
          { label: "Silent", value: summary.silentFails, tone: summary.silentFails > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: auditIronHeadline,
          actions: [
            { label: "Flow admin →", href: "/admin/flow" },
            { label: "Exception inbox →", href: "/exceptions" },
          ],
        }}
      />
      <QrmSubNav />

      {auditQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading workflow audit…</DeckSurface>
      ) : auditQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {auditQuery.error instanceof Error ? auditQuery.error.message : "Workflow audit is unavailable right now."}
        </DeckSurface>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <AuditBucket
            title="Breaks"
            actionHref="/admin/flow"
            actionLabel="Flow admin"
            tone="hot"
            emptyText="No dead-lettered or failed runs right now."
          >
            {board.breaks.slice(0, 10).map((row) => (
              <AuditRow
                key={row.id}
                title={row.workflowSlug}
                detail={`${row.status}${row.errorText ? ` · ${row.errorText}` : ""}`}
                tone="hot"
              />
            ))}
          </AuditBucket>

          <AuditBucket
            title="Stalls"
            actionHref="/qrm/command/approvals"
            actionLabel="Approvals"
            tone="warm"
            emptyText="No stalled workflows right now."
          >
            {board.stalls.slice(0, 10).map((row) => (
              <AuditRow
                key={row.id}
                title={row.workflowSlug}
                detail={`${row.status} · started ${new Date(row.startedAt).toLocaleString()}`}
                tone="warm"
              />
            ))}
          </AuditBucket>

          <AuditBucket
            title="Reroutes"
            actionHref="/admin/flow"
            actionLabel="Flow admin"
            tone="active"
            emptyText="No workflow reroutes or overrides recorded recently."
          >
            {board.reroutes.slice(0, 10).map((row, index) => (
              <AuditRow
                key={`${row.actionType}-${index}`}
                title={row.actionType.replace(/_/g, " ")}
                detail={`Logged ${new Date(row.createdAt).toLocaleString()}`}
                tone="active"
              />
            ))}
          </AuditBucket>

          <AuditBucket
            title="Silent fails"
            actionHref="/exceptions"
            actionLabel="Exceptions"
            tone="warm"
            emptyText="No unresolved workflow exceptions right now."
          >
            {board.silentFails.slice(0, 10).map((row) => (
              <AuditRow
                key={row.id}
                title={row.title}
                detail={`${row.source} · ${row.status}`}
                tone="warm"
              />
            ))}
          </AuditBucket>
        </div>
      )}
    </div>
  );
}

function AuditBucket({
  title,
  actionHref,
  actionLabel,
  tone,
  emptyText,
  children,
}: {
  title: string;
  actionHref: string;
  actionLabel: string;
  tone: StatusTone;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <DeckSurface className="p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone={tone} pulse={tone === "hot"} />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">{title}</h2>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em]">
          <Link to={actionHref}>
            {actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
      <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
        {hasChildren ? children : <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>}
      </div>
    </DeckSurface>
  );
}

function AuditRow({ title, detail, tone }: { title: string; detail: string; tone: StatusTone }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <StatusDot tone={tone} pulse={tone === "hot"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
