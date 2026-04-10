import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowUpRight, RefreshCcw, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Workflow Audit"
        subtitle="Where processes break, stall, reroute, or silently fail across the operating system."
      />
      <QrmSubNav />

      {auditQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading workflow audit…</Card>
      ) : auditQuery.isError || !board ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {auditQuery.error instanceof Error ? auditQuery.error.message : "Workflow audit is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={AlertTriangle} label="Breaks" value={String(board.summary.breaks)} />
            <SummaryCard icon={Timer} label="Stalls" value={String(board.summary.stalls)} />
            <SummaryCard icon={RefreshCcw} label="Reroutes" value={String(board.summary.reroutes)} />
            <SummaryCard icon={Activity} label="Silent Fails" value={String(board.summary.silentFails)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AuditBucket title="Breaks" actionHref="/admin/flow" actionLabel="Flow admin">
              {board.breaks.length === 0 ? (
                <Empty text="No dead-lettered or failed runs right now." />
              ) : (
                board.breaks.slice(0, 10).map((row) => (
                  <AuditRow key={row.id} title={row.workflowSlug} detail={`${row.status}${row.errorText ? ` · ${row.errorText}` : ""}`} />
                ))
              )}
            </AuditBucket>

            <AuditBucket title="Stalls" actionHref="/qrm/command/approvals" actionLabel="Approvals">
              {board.stalls.length === 0 ? (
                <Empty text="No stalled workflows right now." />
              ) : (
                board.stalls.slice(0, 10).map((row) => (
                  <AuditRow key={row.id} title={row.workflowSlug} detail={`${row.status} · started ${new Date(row.startedAt).toLocaleString()}`} />
                ))
              )}
            </AuditBucket>

            <AuditBucket title="Reroutes" actionHref="/admin/flow" actionLabel="Flow admin">
              {board.reroutes.length === 0 ? (
                <Empty text="No workflow reroutes or overrides recorded recently." />
              ) : (
                board.reroutes.slice(0, 10).map((row, index) => (
                  <AuditRow key={`${row.actionType}-${index}`} title={row.actionType.replace(/_/g, " ")} detail={`Logged ${new Date(row.createdAt).toLocaleString()}`} />
                ))
              )}
            </AuditBucket>

            <AuditBucket title="Silent Fails" actionHref="/exceptions" actionLabel="Exception inbox">
              {board.silentFails.length === 0 ? (
                <Empty text="No unresolved workflow-related exceptions right now." />
              ) : (
                board.silentFails.slice(0, 10).map((row) => (
                  <AuditRow key={row.id} title={row.title} detail={`${row.source} · ${row.status}`} />
                ))
              )}
            </AuditBucket>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
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

function AuditBucket({
  title,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  actionHref: string;
  actionLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Button asChild size="sm" variant="outline">
          <Link to={actionHref}>
            {actionLabel} <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </Card>
  );
}

function AuditRow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
