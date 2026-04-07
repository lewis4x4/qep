/**
 * QEP Flow Engine — admin surface (Slice 4).
 *
 * Lists all enabled workflows, recent runs, dead letters, and exposes
 * a "Run now" button to manually invoke the flow-runner edge fn. Drill
 * any run row → FlowRunHistoryDrawer with full step trace.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Workflow, Loader2, AlertOctagon, CheckCircle2, PlayCircle, Sparkles } from "lucide-react";
import { ForwardForecastBar, StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { FlowRunHistoryDrawer, type FlowRunRow } from "../components/flow/FlowRunHistoryDrawer";
import { FlowApprovalsPanel } from "../components/flow/FlowApprovalsPanel";

interface WorkflowDef {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  owner_role: string;
  enabled: boolean;
  trigger_event_pattern: string;
  affects_modules: string[];
  dry_run: boolean;
  version: number;
  updated_at: string;
}

const STATUS_TONE: Record<string, "blue" | "purple" | "orange" | "green" | "red" | "neutral"> = {
  pending: "neutral",
  running: "blue",
  succeeded: "green",
  partially_succeeded: "orange",
  awaiting_approval: "purple",
  failed_retrying: "orange",
  dead_lettered: "red",
  cancelled: "neutral",
};

export function FlowAdminPage() {
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<FlowRunRow | null>(null);
  const [synthBrief, setSynthBrief] = useState("");
  const [synthOpen, setSynthOpen] = useState(false);
  const [synthResult, setSynthResult] = useState<{ definition_id: string | null; missing: string[] } | null>(null);

  const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
    queryKey: ["flow-admin-workflows"],
    queryFn: async (): Promise<WorkflowDef[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: WorkflowDef[] | null; error: unknown }> } };
      }).from("flow_workflow_definitions")
        .select("id, slug, name, description, owner_role, enabled, trigger_event_pattern, affects_modules, dry_run, version, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw new Error("workflows load failed");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const { data: recentRuns = [] } = useQuery({
    queryKey: ["flow-admin-recent-runs"],
    queryFn: async (): Promise<FlowRunRow[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: FlowRunRow[] | null; error: unknown }> } } };
      }).from("flow_workflow_runs")
        .select("id, workflow_slug, status, started_at, finished_at, duration_ms, error_text, resolved_context, metadata, dead_letter_id, event_id")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw new Error("runs load failed");
      return data ?? [];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: deadLetters = [] } = useQuery({
    queryKey: ["flow-admin-dead-letters"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: { id: string; title: string; payload: Record<string, unknown>; created_at: string }[] | null; error: unknown }> } } } };
      }).from("exception_queue")
        .select("id, title, payload, created_at")
        .eq("source", "workflow_dead_letter")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as unknown as {
        functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: { message?: string } | null }> };
      }).functions.invoke("flow-runner", { body: {} });
      if (error) throw new Error(error.message ?? "runner invoke failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow-admin-recent-runs"] });
      queryClient.invalidateQueries({ queryKey: ["flow-admin-dead-letters"] });
    },
  });

  const replayDeadLetter = useMutation({
    mutationFn: async (input: { exceptionId: string; runId: string }) => {
      // Re-emit the original event by calling flow_resume_run, which copies
      // the originating event with parent_event_id set so the runner picks
      // it up next tick. Idempotency keys prevent duplicate side effects.
      const { error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
      }).rpc("flow_resume_run", { p_run_id: input.runId });
      if (error) throw new Error(error.message ?? "replay failed");
      // Mark the exception_queue row as resolved so it disappears from the
      // dead-letter card after a successful replay.
      await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> } };
      }).from("exception_queue").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_reason: "replayed via flow_resume_run",
      }).eq("id", input.exceptionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow-admin-recent-runs"] });
      queryClient.invalidateQueries({ queryKey: ["flow-admin-dead-letters"] });
    },
  });

  const synthesize = useMutation({
    mutationFn: async (brief: string) => {
      const { data, error } = await (supabase as unknown as {
        functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: { ok: boolean; definition_id: string | null; missing: string[]; error?: string } | null; error: { message?: string } | null }> };
      }).functions.invoke("flow-synthesize", { body: { brief } });
      if (error) throw new Error(error.message ?? "synth failed");
      if (!data?.ok) throw new Error(data?.error ?? "synth failed");
      return data;
    },
    onSuccess: (data) => {
      setSynthResult({ definition_id: data.definition_id, missing: data.missing ?? [] });
      setSynthBrief("");
      queryClient.invalidateQueries({ queryKey: ["flow-admin-workflows"] });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      const { error } = await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
      }).from("flow_workflow_definitions").update({ enabled: input.enabled }).eq("id", input.id);
      if (error) throw new Error("toggle failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flow-admin-workflows"] }),
  });

  // Rollup tile counts
  const last24h = recentRuns.filter((r) => Date.now() - new Date(r.started_at).getTime() < 24 * 3600 * 1000);
  const succeeded = last24h.filter((r) => r.status === "succeeded").length;
  const failed = last24h.filter((r) => r.status === "dead_lettered" || r.status === "cancelled").length;
  const awaiting = recentRuns.filter((r) => r.status === "awaiting_approval").length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Workflow className="h-5 w-5 text-qep-orange" /> Flow Engine
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Internal automation fabric · {workflows.length} workflows registered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSynthOpen((p) => !p)}>
            <Sparkles className="mr-1 h-3 w-3" /> Synthesize
          </Button>
          <Button size="sm" variant="outline" disabled={runNow.isPending} onClick={() => runNow.mutate()}>
            {runNow.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PlayCircle className="mr-1 h-3 w-3" />}
            Run now
          </Button>
        </div>
      </div>

      {synthOpen && (
        <Card className="border-qep-orange/20 bg-qep-orange/5 p-4">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-qep-orange">Synthesize a workflow from English</p>
          <textarea
            value={synthBrief}
            onChange={(e) => setSynthBrief(e.target.value)}
            placeholder="When a strategic account has a service delay AND there's an open opportunity, alert the rep with the deal value and a suggested message."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
            rows={4}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              disabled={synthesize.isPending || synthBrief.length < 10}
              onClick={() => synthesize.mutate(synthBrief)}
            >
              {synthesize.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              Generate draft
            </Button>
            {synthesize.error && (
              <span className="text-[10px] text-red-400">{(synthesize.error as Error).message}</span>
            )}
          </div>
          {synthResult && (
            <div className="mt-2 rounded bg-emerald-500/5 p-2 text-[11px]">
              <p className="text-emerald-400">
                ✓ Draft created (id: {synthResult.definition_id?.slice(0, 8)}…). Disabled by default — review and enable below.
              </p>
              {synthResult.missing.length > 0 && (
                <p className="mt-1 text-amber-400">
                  Missing primitives: {synthResult.missing.join(", ")} — extend the registry before enabling.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <ForwardForecastBar
        counters={[
          { label: "Runs (24h)", value: last24h.length, tone: "blue" },
          { label: "Succeeded", value: succeeded, tone: "green" },
          { label: "Failed/cancelled", value: failed, tone: "red" },
          { label: "Awaiting approval", value: awaiting, tone: "orange" },
          { label: "Dead letters open", value: deadLetters.length, tone: "red" },
        ]}
      />

      {/* Workflows table */}
      <Card className="p-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Workflows</p>
        {workflowsLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : workflows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No workflows registered yet. Run the runner once to auto-sync the TS files.</p>
        ) : (
          <div className="space-y-2">
            {workflows.map((wf) => (
              <div key={wf.id} className="flex items-start justify-between gap-3 rounded border border-border/60 bg-muted/10 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-foreground">{wf.name}</p>
                    <code className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{wf.slug}</code>
                    {wf.dry_run && (
                      <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase text-amber-400">dry-run</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{wf.description}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">trigger:</span>
                    <code className="text-foreground">{wf.trigger_event_pattern}</code>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">role: {wf.owner_role}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">v{wf.version}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={wf.enabled ? "default" : "outline"}
                  onClick={() => toggleEnabled.mutate({ id: wf.id, enabled: !wf.enabled })}
                >
                  {wf.enabled ? "Enabled" : "Disabled"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent runs */}
      <Card className="p-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Recent runs</p>
        {recentRuns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet. Click "Run now" or trigger an event.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {recentRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRun(run)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border/60 bg-muted/10 p-2 text-left hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] text-foreground">{run.workflow_slug}</code>
                    <StatusChipStack chips={[{ label: run.status.replace(/_/g, " "), tone: STATUS_TONE[run.status] ?? "neutral" }]} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {new Date(run.started_at).toLocaleString()}
                    {run.duration_ms != null && ` · ${run.duration_ms}ms`}
                  </p>
                </div>
                {run.status === "succeeded" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                {run.status === "dead_lettered" && <AlertOctagon className="h-3 w-3 text-red-400" />}
              </button>
            ))}
          </div>
        )}
      </Card>

      <FlowApprovalsPanel />

      {/* Dead letters */}
      {deadLetters.length > 0 && (
        <Card className="border-red-500/30 p-4">
          <p className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-400">
            <AlertOctagon className="h-3 w-3" /> Dead letters
          </p>
          <div className="space-y-1.5">
            {deadLetters.map((dl) => {
              const runId = dl.payload?.flow_run_id as string | undefined;
              return (
                <div key={dl.id} className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{dl.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {new Date(dl.created_at).toLocaleString()} · run {runId?.slice(0, 8) ?? "—"}…
                      </p>
                    </div>
                    {runId && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={replayDeadLetter.isPending}
                        onClick={() => replayDeadLetter.mutate({ exceptionId: dl.id, runId })}
                      >
                        {replayDeadLetter.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Replay"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <FlowRunHistoryDrawer run={selectedRun} onClose={() => setSelectedRun(null)} />
    </div>
  );
}
