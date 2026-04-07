/**
 * QEP Flow Engine — admin surface (Slice 4).
 *
 * Lists all enabled workflows, recent runs, dead letters, and exposes
 * a "Run now" button to manually invoke the flow-runner edge fn. Drill
 * any run row → FlowRunHistoryDrawer with full step trace.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Workflow, Loader2, AlertOctagon, CheckCircle2, PlayCircle, Sparkles, Bot, Zap, Lightbulb, X } from "lucide-react";
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
  // Wave 7 Iron columns (additive, may be null for legacy automated flows)
  surface?: string | null;
  iron_metadata?: { short_label?: string; iron_role?: string } | null;
  feature_flag?: string | null;
}

type SurfaceFilter = "all" | "automated" | "iron";

interface IronSuggestionRow {
  id: string;
  pattern_signature: string;
  short_label: string | null;
  intent_examples: Array<{ message: string; conversation_id: string; occurred_at: string }>;
  occurrence_count: number;
  unique_users: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  promoted_flow_id: string | null;
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
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");

  const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
    queryKey: ["flow-admin-workflows"],
    queryFn: async (): Promise<WorkflowDef[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: WorkflowDef[] | null; error: unknown }> } };
      }).from("flow_workflow_definitions")
        .select("id, slug, name, description, owner_role, enabled, trigger_event_pattern, affects_modules, dry_run, version, updated_at, surface, iron_metadata, feature_flag")
        .order("updated_at", { ascending: false });
      if (error) throw new Error("workflows load failed");
      return data ?? [];
    },
    staleTime: 30_000,
  });

  // Surface-filtered subset, computed before render
  const filteredWorkflows = useMemo(() => {
    if (surfaceFilter === "all") return workflows;
    if (surfaceFilter === "iron") {
      return workflows.filter((w) => w.surface === "iron_conversational" || w.surface === "iron_voice");
    }
    return workflows.filter((w) => !w.surface || w.surface === "automated");
  }, [workflows, surfaceFilter]);

  const ironCount = useMemo(
    () => workflows.filter((w) => w.surface === "iron_conversational" || w.surface === "iron_voice").length,
    [workflows],
  );

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

  // ── Wave 7 v1.3: Iron flow suggestions (pattern-mined) ────────────────
  const { data: suggestions = [] } = useQuery({
    queryKey: ["iron-flow-suggestions"],
    queryFn: async (): Promise<IronSuggestionRow[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              order: (col: string, opts: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: IronSuggestionRow[] | null; error: unknown }>;
              };
            };
          };
        };
      }).from("iron_flow_suggestions")
        .select("id, pattern_signature, short_label, intent_examples, occurrence_count, unique_users, first_seen_at, last_seen_at, status, promoted_flow_id")
        .eq("status", "open")
        .order("occurrence_count", { ascending: false })
        .limit(20);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const runPatternMining = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as unknown as {
        functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: { ok: boolean; suggestions_upserted?: number; error?: string } | null; error: { message?: string } | null }> };
      }).functions.invoke("iron-pattern-mining", { body: {} });
      if (error) throw new Error(error.message ?? "pattern mining failed");
      if (!data?.ok) throw new Error(data?.error ?? "pattern mining failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["iron-flow-suggestions"] });
    },
  });

  const promoteSuggestion = useMutation({
    mutationFn: async (suggestion: IronSuggestionRow) => {
      // Build the flow-synthesize brief from the most representative example
      const exemplar = suggestion.intent_examples?.[0]?.message ?? suggestion.short_label ?? suggestion.pattern_signature;
      const brief = `Pattern observed ${suggestion.occurrence_count} times across ${suggestion.unique_users} user(s): "${exemplar}". Build an Iron-conversational flow that handles this intent.`;

      const { data: synthData, error: synthErr } = await (supabase as unknown as {
        functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => Promise<{ data: { ok: boolean; definition_id: string | null; error?: string } | null; error: { message?: string } | null }> };
      }).functions.invoke("flow-synthesize", { body: { brief } });
      if (synthErr) throw new Error(synthErr.message ?? "synth failed");
      if (!synthData?.ok || !synthData.definition_id) {
        throw new Error(synthData?.error ?? "synth failed");
      }

      // Link the new draft back to the suggestion
      const { error: updateErr } = await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message?: string } | null }> } };
      }).from("iron_flow_suggestions").update({
        status: "promoted",
        promoted_flow_id: synthData.definition_id,
        promoted_at: new Date().toISOString(),
      }).eq("id", suggestion.id);
      if (updateErr) throw new Error(updateErr.message ?? "link failed");

      return synthData.definition_id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["iron-flow-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["flow-admin-workflows"] });
    },
  });

  const dismissSuggestion = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message?: string } | null }> } };
      }).from("iron_flow_suggestions").update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        dismissed_reason: "manager declined from admin UI",
      }).eq("id", suggestionId);
      if (error) throw new Error(error.message ?? "dismiss failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["iron-flow-suggestions"] }),
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
          <Button
            size="sm"
            variant="outline"
            disabled={runPatternMining.isPending}
            onClick={() => runPatternMining.mutate()}
            title="Mine iron_messages for repeated CLARIFY/READ_ANSWER intents and write to iron_flow_suggestions"
          >
            {runPatternMining.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Lightbulb className="mr-1 h-3 w-3" />
            )}
            Mine patterns
          </Button>
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

      {/* Surface filter chips: All / Automated / Iron */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Surface:</span>
        {(["all", "automated", "iron"] as SurfaceFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSurfaceFilter(s)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
              surfaceFilter === s
                ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/30"
            }`}
          >
            {s === "iron" && <Bot className="h-3 w-3" />}
            {s === "all" ? `All (${workflows.length})` : s === "iron" ? `Iron (${ironCount})` : `Automated (${workflows.length - ironCount})`}
          </button>
        ))}
      </div>

      {/* Workflows table */}
      <Card className="p-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {surfaceFilter === "iron" ? "Iron Companion flows" : surfaceFilter === "automated" ? "Automated workflows" : "Workflows"}
        </p>
        {workflowsLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : filteredWorkflows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {surfaceFilter === "iron"
              ? "No Iron flows registered yet. Run the flow-runner once to auto-sync the iron-flows.ts manifest."
              : "No workflows registered yet. Run the runner once to auto-sync the TS files."}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredWorkflows.map((wf) => {
              const isIron = wf.surface === "iron_conversational" || wf.surface === "iron_voice";
              return (
                <div key={wf.id} className="flex items-start justify-between gap-3 rounded border border-border/60 bg-muted/10 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isIron && <Zap className="h-3 w-3 shrink-0 text-qep-orange" aria-hidden />}
                      <p className="text-xs font-semibold text-foreground">{wf.name}</p>
                      <code className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{wf.slug}</code>
                      {isIron && wf.iron_metadata?.iron_role && (
                        <span className="rounded-full bg-qep-orange/10 px-1.5 py-0.5 text-[9px] uppercase text-qep-orange">
                          {wf.iron_metadata.iron_role.replace(/^iron_/, "")}
                        </span>
                      )}
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
                      {wf.feature_flag && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">flag: {wf.feature_flag}</span>
                        </>
                      )}
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
              );
            })}
          </div>
        )}
      </Card>

      {/* Iron flow suggestions (pattern-mined) — only shown when not filtered to automated */}
      {surfaceFilter !== "automated" && suggestions.length > 0 && (
        <Card className="border-qep-orange/30 p-4">
          <p className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-qep-orange">
            <Lightbulb className="h-3 w-3" /> Iron flow suggestions
            <span className="ml-1 rounded-full bg-qep-orange/15 px-1.5 py-0.5 text-[9px] normal-case">
              pattern-mined · {suggestions.length} open
            </span>
          </p>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Iron observed these intents repeatedly without a flow to dispatch to. Click <span className="text-foreground">Promote</span> to draft a flow definition via flow-synthesize.
          </p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 rounded border border-qep-orange/20 bg-qep-orange/5 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground line-clamp-1">
                    {s.short_label ?? s.pattern_signature}
                  </p>
                  {s.intent_examples?.[0]?.message && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] italic text-muted-foreground">
                      "{s.intent_examples[0].message}"
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{s.occurrence_count}× hits</span>
                    <span>·</span>
                    <span>{s.unique_users} user{s.unique_users === 1 ? "" : "s"}</span>
                    <span>·</span>
                    <span>last seen {new Date(s.last_seen_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => promoteSuggestion.mutate(s)}
                    disabled={promoteSuggestion.isPending}
                  >
                    {promoteSuggestion.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="mr-1 h-3 w-3" /> Promote
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissSuggestion.mutate(s.id)}
                    disabled={dismissSuggestion.isPending}
                    aria-label="Dismiss suggestion"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {promoteSuggestion.error && (
            <p className="mt-2 text-[10px] text-red-400">
              Promote failed: {(promoteSuggestion.error as Error).message}
            </p>
          )}
          {runPatternMining.data && (
            <p className="mt-2 text-[10px] text-emerald-400">
              ✓ Mining run complete · {runPatternMining.data.suggestions_upserted ?? 0} suggestions upserted
            </p>
          )}
        </Card>
      )}

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
