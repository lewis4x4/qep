/**
 * QEP Flow Engine — admin surface (Slice 4).
 *
 * Lists all enabled workflows, recent runs, dead letters, and exposes
 * a "Run now" button to manually invoke the flow-runner edge fn. Drill
 * any run row → FlowRunHistoryDrawer with full step trace.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Workflow, Loader2, AlertOctagon, CheckCircle2, PlayCircle, Sparkles, Bot, Zap, Lightbulb, X, Activity } from "lucide-react";
import { ForwardForecastBar, StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/lib/database.types";
import { FlowRunHistoryDrawer, type FlowRunRow } from "../components/flow/FlowRunHistoryDrawer";
import { FlowApprovalsPanel } from "../components/flow/FlowApprovalsPanel";
import { SloSparkline } from "@/lib/iron/SloSparkline";
import { getQuoteApprovalPolicy, saveQuoteApprovalPolicy } from "@/features/quote-builder/lib/quote-api";
import type { QuoteApprovalConditionType, QuoteApprovalPolicy } from "../../../../../../shared/qep-moonshot-contracts";

const db = supabase as SupabaseClient<Database>;

type FlowWorkflowDefinitionRow = Database["public"]["Tables"]["flow_workflow_definitions"]["Row"];
type FlowWorkflowRunRow = Database["public"]["Tables"]["flow_workflow_runs"]["Row"];
type ExceptionQueueRow = Database["public"]["Tables"]["exception_queue"]["Row"];
type ExceptionQueueUpdate = Database["public"]["Tables"]["exception_queue"]["Update"];
type IronFlowSuggestionDbRow = Database["public"]["Tables"]["iron_flow_suggestions"]["Row"];
type IronFlowSuggestionUpdate = Database["public"]["Tables"]["iron_flow_suggestions"]["Update"];

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

interface IronSloSnapshot {
  computed_at: string;
  workspace_id: string;
  classify_p95_ms: number | null;
  classify_target_ms: number;
  classify_pass: boolean;
  execute_p95_ms: number | null;
  execute_target_ms: number;
  execute_pass: boolean;
  undo_success_rate: number | null;
  undo_target_rate: number;
  undo_attempts: number;
  undo_pass: boolean;
  dead_letter_rate: number | null;
  dead_letter_target_rate: number;
  iron_runs_total: number;
  dead_letter_pass: boolean;
  cost_escalation_pct: number | null;
  cost_target_pct: number;
  active_users_24h: number;
  cost_pass: boolean;
}

type FlowRunnerResponse = unknown;
type FlowSynthesizeResponse = { ok: boolean; definition_id: string | null; missing?: string[]; error?: string };
type IronPatternMiningResponse = { ok: boolean; suggestions_upserted?: number; error?: string };
type JsonRecord = { [key: string]: Json | undefined };
type WorkflowDefSelectedRow = Pick<
  FlowWorkflowDefinitionRow,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "owner_role"
  | "enabled"
  | "trigger_event_pattern"
  | "affects_modules"
  | "dry_run"
  | "version"
  | "updated_at"
  | "surface"
  | "iron_metadata"
  | "feature_flag"
>;
type FlowRunSelectedRow = Pick<
  FlowWorkflowRunRow,
  | "id"
  | "workflow_slug"
  | "status"
  | "started_at"
  | "finished_at"
  | "duration_ms"
  | "error_text"
  | "resolved_context"
  | "metadata"
  | "dead_letter_id"
  | "event_id"
>;
type IronFlowSuggestionSelectedRow = Pick<
  IronFlowSuggestionDbRow,
  | "id"
  | "pattern_signature"
  | "short_label"
  | "intent_examples"
  | "occurrence_count"
  | "unique_users"
  | "first_seen_at"
  | "last_seen_at"
  | "status"
  | "promoted_flow_id"
>;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function toStringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toIronMetadata(value: Json | null): WorkflowDef["iron_metadata"] {
  const record = toRecord(value);
  if (!record) return null;
  return {
    short_label: typeof record.short_label === "string" ? record.short_label : undefined,
    iron_role: typeof record.iron_role === "string" ? record.iron_role : undefined,
  };
}

function toWorkflowDef(row: WorkflowDefSelectedRow): WorkflowDef {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    owner_role: row.owner_role,
    enabled: row.enabled,
    trigger_event_pattern: row.trigger_event_pattern,
    affects_modules: toStringArray(row.affects_modules),
    dry_run: row.dry_run,
    version: row.version,
    updated_at: row.updated_at,
    surface: row.surface,
    iron_metadata: toIronMetadata(row.iron_metadata),
    feature_flag: row.feature_flag,
  };
}

function toFlowRunRow(row: FlowRunSelectedRow): FlowRunRow {
  return {
    id: row.id,
    workflow_slug: row.workflow_slug,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    error_text: row.error_text,
    resolved_context: toRecord(row.resolved_context),
    metadata: toRecord(row.metadata),
    dead_letter_id: row.dead_letter_id,
    event_id: row.event_id,
  };
}

function toDeadLetterRow(row: Pick<ExceptionQueueRow, "id" | "title" | "payload" | "created_at">) {
  return {
    id: row.id,
    title: row.title,
    payload: toRecord(row.payload) ?? {},
    created_at: row.created_at,
  };
}

function toIntentExamples(value: Json): IronSuggestionRow["intent_examples"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      message: typeof item.message === "string" ? item.message : "",
      conversation_id: typeof item.conversation_id === "string" ? item.conversation_id : "",
      occurred_at: typeof item.occurred_at === "string" ? item.occurred_at : "",
    }))
    .filter((item) => item.message.length > 0);
}

function toIronSuggestionRow(row: IronFlowSuggestionSelectedRow): IronSuggestionRow {
  return {
    id: row.id,
    pattern_signature: row.pattern_signature,
    short_label: row.short_label,
    intent_examples: toIntentExamples(row.intent_examples),
    occurrence_count: row.occurrence_count,
    unique_users: row.unique_users,
    first_seen_at: row.first_seen_at ?? new Date(0).toISOString(),
    last_seen_at: row.last_seen_at ?? row.first_seen_at ?? new Date(0).toISOString(),
    status: row.status,
    promoted_flow_id: row.promoted_flow_id,
  };
}

function numberFromRecord(record: Record<string, unknown>, key: keyof IronSloSnapshot, fallback = 0): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumberFromRecord(record: Record<string, unknown>, key: keyof IronSloSnapshot): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanFromRecord(record: Record<string, unknown>, key: keyof IronSloSnapshot): boolean {
  return record[key] === true;
}

function toIronSloSnapshot(value: unknown): IronSloSnapshot | null {
  const record = toRecord(value);
  if (!record) return null;
  return {
    computed_at: typeof record.computed_at === "string" ? record.computed_at : new Date(0).toISOString(),
    workspace_id: typeof record.workspace_id === "string" ? record.workspace_id : "default",
    classify_p95_ms: nullableNumberFromRecord(record, "classify_p95_ms"),
    classify_target_ms: numberFromRecord(record, "classify_target_ms"),
    classify_pass: booleanFromRecord(record, "classify_pass"),
    execute_p95_ms: nullableNumberFromRecord(record, "execute_p95_ms"),
    execute_target_ms: numberFromRecord(record, "execute_target_ms"),
    execute_pass: booleanFromRecord(record, "execute_pass"),
    undo_success_rate: nullableNumberFromRecord(record, "undo_success_rate"),
    undo_target_rate: numberFromRecord(record, "undo_target_rate"),
    undo_attempts: numberFromRecord(record, "undo_attempts"),
    undo_pass: booleanFromRecord(record, "undo_pass"),
    dead_letter_rate: nullableNumberFromRecord(record, "dead_letter_rate"),
    dead_letter_target_rate: numberFromRecord(record, "dead_letter_target_rate"),
    iron_runs_total: numberFromRecord(record, "iron_runs_total"),
    dead_letter_pass: booleanFromRecord(record, "dead_letter_pass"),
    cost_escalation_pct: nullableNumberFromRecord(record, "cost_escalation_pct"),
    cost_target_pct: numberFromRecord(record, "cost_target_pct"),
    active_users_24h: numberFromRecord(record, "active_users_24h"),
    cost_pass: booleanFromRecord(record, "cost_pass"),
  };
}

export function normalizeIronSloHistorySnapshots(value: unknown): IronSloSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const record = toRecord(row);
    if (!record) return [];
    const snapshot = toIronSloSnapshot(record.snapshot);
    return snapshot ? [snapshot] : [];
  });
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  const record = toRecord(value);
  if (record && typeof record.message === "string" && record.message.trim()) return record.message;
  return fallback;
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
  const [quotePolicyDraft, setQuotePolicyDraft] = useState<QuoteApprovalPolicy | null>(null);

  const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
    queryKey: ["flow-admin-workflows"],
    queryFn: async (): Promise<WorkflowDef[]> => {
      const { data, error } = await db
        .from("flow_workflow_definitions")
        .select("id, slug, name, description, owner_role, enabled, trigger_event_pattern, affects_modules, dry_run, version, updated_at, surface, iron_metadata, feature_flag")
        .order("updated_at", { ascending: false });
      if (error) throw new Error("workflows load failed");
      return (data ?? []).map(toWorkflowDef);
    },
    staleTime: 30_000,
  });

  const quotePolicyQuery = useQuery({
    queryKey: ["quote-approval-policy"],
    queryFn: getQuoteApprovalPolicy,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (quotePolicyQuery.data) {
      setQuotePolicyDraft(quotePolicyQuery.data);
    }
  }, [quotePolicyQuery.data]);

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
      const { data, error } = await db
        .from("flow_workflow_runs")
        .select("id, workflow_slug, status, started_at, finished_at, duration_ms, error_text, resolved_context, metadata, dead_letter_id, event_id")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw new Error("runs load failed");
      return (data ?? []).map(toFlowRunRow);
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: deadLetters = [] } = useQuery({
    queryKey: ["flow-admin-dead-letters"],
    queryFn: async () => {
      const { data, error } = await db
        .from("exception_queue")
        .select("id, title, payload, created_at")
        .eq("source", "workflow_dead_letter")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return (data ?? []).map(toDeadLetterRow);
    },
    staleTime: 60_000,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<FlowRunnerResponse>("flow-runner", { body: {} });
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
      const { error } = await db.rpc("flow_resume_run", { p_run_id: input.runId });
      if (error) throw new Error(error.message ?? "replay failed");
      // Mark the exception_queue row as resolved so it disappears from the
      // dead-letter card after a successful replay.
      const patch: ExceptionQueueUpdate = {
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_reason: "replayed via flow_resume_run",
      };
      await db.from("exception_queue").update(patch).eq("id", input.exceptionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow-admin-recent-runs"] });
      queryClient.invalidateQueries({ queryKey: ["flow-admin-dead-letters"] });
    },
  });

  const synthesize = useMutation({
    mutationFn: async (brief: string) => {
      const { data, error } = await supabase.functions.invoke<FlowSynthesizeResponse>("flow-synthesize", { body: { brief } });
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
      const { error } = await db.from("flow_workflow_definitions").update({ enabled: input.enabled }).eq("id", input.id);
      if (error) throw new Error("toggle failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flow-admin-workflows"] }),
  });

  const saveQuotePolicyMutation = useMutation({
    mutationFn: async () => {
      if (!quotePolicyDraft) throw new Error("Quote approval policy is not loaded.");
      return saveQuoteApprovalPolicy(quotePolicyDraft);
    },
    onSuccess: (policy) => {
      queryClient.invalidateQueries({ queryKey: ["quote-approval-policy"] });
      setQuotePolicyDraft(policy);
    },
  });

  // ── Wave 7 v1.3: Iron flow suggestions (pattern-mined) ────────────────
  const { data: suggestions = [] } = useQuery({
    queryKey: ["iron-flow-suggestions"],
    queryFn: async (): Promise<IronSuggestionRow[]> => {
      const { data, error } = await db
        .from("iron_flow_suggestions")
        .select("id, pattern_signature, short_label, intent_examples, occurrence_count, unique_users, first_seen_at, last_seen_at, status, promoted_flow_id")
        .eq("status", "open")
        .order("occurrence_count", { ascending: false })
        .limit(20);
      if (error) return [];
      return (data ?? []).map(toIronSuggestionRow);
    },
    staleTime: 60_000,
  });

  const runPatternMining = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<IronPatternMiningResponse>("iron-pattern-mining", { body: {} });
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

      const { data: synthData, error: synthErr } = await supabase.functions.invoke<FlowSynthesizeResponse>("flow-synthesize", { body: { brief } });
      if (synthErr) throw new Error(synthErr.message ?? "synth failed");
      if (!synthData?.ok || !synthData.definition_id) {
        throw new Error(synthData?.error ?? "synth failed");
      }

      // Link the new draft back to the suggestion
      const patch: IronFlowSuggestionUpdate = {
        status: "promoted",
        promoted_flow_id: synthData.definition_id,
        promoted_at: new Date().toISOString(),
      };
      const { error: updateErr } = await db.from("iron_flow_suggestions").update(patch).eq("id", suggestion.id);
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
      const patch: IronFlowSuggestionUpdate = {
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        dismissed_reason: "manager declined from admin UI",
      };
      const { error } = await db.from("iron_flow_suggestions").update(patch).eq("id", suggestionId);
      if (error) throw new Error(error.message ?? "dismiss failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["iron-flow-suggestions"] }),
  });

  // ── Wave 7 v1.6: Iron SLO compliance snapshot ─────────────────────────
  const { data: ironSlos } = useQuery({
    queryKey: ["iron-slo-snapshot"],
    queryFn: async (): Promise<IronSloSnapshot | null> => {
      const { data, error } = await db.rpc("iron_compute_slos", { p_workspace_id: "default" });
      if (error) return null;
      return toIronSloSnapshot(data);
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // ── Wave 7 v1.10: Iron SLO history (last 30 snapshots for sparklines) ─
  const { data: ironSloHistory = [] } = useQuery({
    queryKey: ["iron-slo-history"],
    queryFn: async (): Promise<IronSloSnapshot[]> => {
      const { data, error } = await db
        .from("iron_slo_history")
        .select("snapshot")
        .eq("workspace_id", "default")
        .order("computed_at", { ascending: false })
        .limit(30);
      if (error) return [];
      // Snapshots come back newest-first; reverse so the sparkline reads
      // left=oldest → right=newest, which is the convention humans expect.
      return normalizeIronSloHistorySnapshots(data).reverse();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Derive per-metric series in one pass
  const sloSeries = useMemo(() => ({
    classify: ironSloHistory.map((s) => s.classify_p95_ms),
    execute: ironSloHistory.map((s) => s.execute_p95_ms),
    undo: ironSloHistory.map((s) => s.undo_success_rate),
    deadLetter: ironSloHistory.map((s) => s.dead_letter_rate),
    cost: ironSloHistory.map((s) => s.cost_escalation_pct),
  }), [ironSloHistory]);

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
        <div className="flex flex-col items-end gap-1">
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
          {/*
            Per-button error surfaces. Each sits directly under its button
            so the operator sees the reason at the point of action instead
            of a single shared banner at the top of the page.
          */}
          {runPatternMining.isError && (
            <span className="text-[10px] text-red-400">
              Mine patterns: {errorMessage(runPatternMining.error, "failed")}
            </span>
          )}
          {runNow.isError && (
            <span className="text-[10px] text-red-400">
              Run now: {errorMessage(runNow.error, "failed")}
            </span>
          )}
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
              <span className="text-[10px] text-red-400">{errorMessage(synthesize.error, "Generate failed")}</span>
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

      <Card className="p-4">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Quote approval policy</p>
        {!quotePolicyDraft ? (
          <p className="text-xs text-muted-foreground">
            {quotePolicyQuery.isLoading ? "Loading quote approval policy…" : "Quote approval policy unavailable."}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Branch manager min margin %</span>
                <Input
                  type="number"
                  value={String(quotePolicyDraft.branchManagerMinMarginPct)}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    branchManagerMinMarginPct: Number(event.target.value || 0),
                  } : current)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Standard floor %</span>
                <Input
                  type="number"
                  value={String(quotePolicyDraft.standardMarginFloorPct)}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    standardMarginFloorPct: Number(event.target.value || 0),
                  } : current)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Branch manager max quote $</span>
                <Input
                  type="number"
                  value={String(quotePolicyDraft.branchManagerMaxQuoteAmount)}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    branchManagerMaxQuoteAmount: Number(event.target.value || 0),
                  } : current)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Submit SLA hours</span>
                <Input
                  type="number"
                  value={String(quotePolicyDraft.submitSlaHours)}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    submitSlaHours: Number(event.target.value || 0),
                  } : current)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Escalation SLA hours</span>
                <Input
                  type="number"
                  value={String(quotePolicyDraft.escalationSlaHours)}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    escalationSlaHours: Number(event.target.value || 0),
                  } : current)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Owner escalation role</span>
                <select
                  value={quotePolicyDraft.ownerEscalationRole}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    ownerEscalationRole: event.target.value === "admin" ? "admin" : "owner",
                  } : current)}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={quotePolicyDraft.namedBranchSalesManagerPrimary}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    namedBranchSalesManagerPrimary: event.target.checked,
                  } : current)}
                />
                Use branch sales manager as primary approver
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={quotePolicyDraft.namedBranchGeneralManagerFallback}
                  onChange={(event) => setQuotePolicyDraft((current) => current ? {
                    ...current,
                    namedBranchGeneralManagerFallback: event.target.checked,
                  } : current)}
                />
                Use branch general manager as fallback approver
              </label>
            </div>

            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Allowed condition types</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  "min_margin_pct",
                  "max_trade_allowance",
                  "required_cash_down",
                  "required_finance_scenario",
                  "remove_attachment",
                  "expiry_hours",
                ] as QuoteApprovalConditionType[]).map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={quotePolicyDraft.allowedConditionTypes.includes(type)}
                      onChange={(event) => setQuotePolicyDraft((current) => {
                        if (!current) return current;
                        return {
                          ...current,
                          allowedConditionTypes: event.target.checked
                            ? [...current.allowedConditionTypes, type]
                            : current.allowedConditionTypes.filter((value) => value !== type),
                        };
                      })}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {saveQuotePolicyMutation.isError && (
                <span className="text-[10px] text-red-400">
                  {errorMessage(saveQuotePolicyMutation.error, "Save failed")}
                </span>
              )}
              {saveQuotePolicyMutation.isSuccess && (
                <span className="text-[10px] text-emerald-400">Policy saved</span>
              )}
              <Button
                size="sm"
                onClick={() => saveQuotePolicyMutation.mutate()}
                disabled={saveQuotePolicyMutation.isPending || quotePolicyDraft.allowedConditionTypes.length === 0}
              >
                {saveQuotePolicyMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Save quote policy
              </Button>
            </div>
          </div>
        )}
      </Card>

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

      {/* Iron health card (SLO compliance snapshot — surfaced when not viewing automated only) */}
      {surfaceFilter !== "automated" && ironSlos && (
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3 w-3 text-qep-orange" /> Iron health
            <span className="ml-1 normal-case text-muted-foreground/70">
              (computed {new Date(ironSlos.computed_at).toLocaleTimeString()})
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <SloPill
              label="Classify p95"
              value={ironSlos.classify_p95_ms != null ? `${ironSlos.classify_p95_ms} ms` : "—"}
              target={`< ${ironSlos.classify_target_ms} ms`}
              pass={ironSlos.classify_pass}
              series={sloSeries.classify}
              seriesLowerIsBetter
              seriesTarget={ironSlos.classify_target_ms}
            />
            <SloPill
              label="Execute p95"
              value={ironSlos.execute_p95_ms != null ? `${ironSlos.execute_p95_ms} ms` : "—"}
              target={`< ${ironSlos.execute_target_ms} ms`}
              pass={ironSlos.execute_pass}
              series={sloSeries.execute}
              seriesLowerIsBetter
              seriesTarget={ironSlos.execute_target_ms}
            />
            <SloPill
              label="Undo success"
              value={
                ironSlos.undo_success_rate != null
                  ? `${(ironSlos.undo_success_rate * 100).toFixed(1)}%`
                  : "—"
              }
              target={`> ${(ironSlos.undo_target_rate * 100).toFixed(1)}%`}
              pass={ironSlos.undo_pass}
              footnote={`${ironSlos.undo_attempts} attempts (30d)`}
              series={sloSeries.undo}
              seriesLowerIsBetter={false}
              seriesTarget={ironSlos.undo_target_rate}
            />
            <SloPill
              label="Dead letter rate"
              value={
                ironSlos.dead_letter_rate != null
                  ? `${(ironSlos.dead_letter_rate * 100).toFixed(2)}%`
                  : "—"
              }
              target={`< ${(ironSlos.dead_letter_target_rate * 100).toFixed(1)}%`}
              pass={ironSlos.dead_letter_pass}
              footnote={`${ironSlos.iron_runs_total} runs (7d)`}
              series={sloSeries.deadLetter}
              seriesLowerIsBetter
              seriesTarget={ironSlos.dead_letter_target_rate}
            />
            <SloPill
              label="Cost escalations"
              value={
                ironSlos.cost_escalation_pct != null
                  ? `${(ironSlos.cost_escalation_pct * 100).toFixed(1)}%`
                  : "—"
              }
              target={`< ${(ironSlos.cost_target_pct * 100).toFixed(0)}%`}
              pass={ironSlos.cost_pass}
              footnote={`${ironSlos.active_users_24h} active 24h`}
              series={sloSeries.cost}
              seriesLowerIsBetter
              seriesTarget={ironSlos.cost_target_pct}
            />
          </div>
          {ironSloHistory.length > 0 && (
            <p className="mt-2 text-[9px] text-muted-foreground/70">
              Trend window: last {ironSloHistory.length} snapshot{ironSloHistory.length === 1 ? "" : "s"} · target line dashed
            </p>
          )}
        </Card>
      )}

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
                  <div className="flex flex-col items-end gap-0.5">
                    <Button
                      size="sm"
                      variant={wf.enabled ? "default" : "outline"}
                      onClick={() => toggleEnabled.mutate({ id: wf.id, enabled: !wf.enabled })}
                    >
                      {wf.enabled ? "Enabled" : "Disabled"}
                    </Button>
                    {toggleEnabled.isError && toggleEnabled.variables?.id === wf.id && (
                      <span className="text-[10px] text-red-400">
                        {errorMessage(toggleEnabled.error, "toggle failed")}
                      </span>
                    )}
                  </div>
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
              Promote failed: {errorMessage(promoteSuggestion.error, "unknown")}
            </p>
          )}
          {dismissSuggestion.isError && (
            <p className="mt-2 text-[10px] text-red-400">
              Dismiss failed: {errorMessage(dismissSuggestion.error, "unknown")}
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
                  {replayDeadLetter.isError && replayDeadLetter.variables?.exceptionId === dl.id && (
                    <p className="mt-1 text-[10px] text-red-400">
                      {errorMessage(replayDeadLetter.error, "replay failed")}
                    </p>
                  )}
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

/* ─── Wave 7 v1.6: Iron SLO pill (with v1.10 sparkline) ───────────────── */

interface SloPillProps {
  label: string;
  value: string;
  target: string;
  pass: boolean;
  footnote?: string;
  // v1.10: trend sparkline series. Optional so the pill still renders on
  // fresh deployments where iron_slo_history hasn't been populated yet.
  series?: Array<number | null>;
  seriesLowerIsBetter?: boolean;
  seriesTarget?: number;
}

function SloPill({
  label,
  value,
  target,
  pass,
  footnote,
  series,
  seriesLowerIsBetter,
  seriesTarget,
}: SloPillProps) {
  const hasSeries = series && series.length > 0 && seriesTarget != null;
  return (
    <div
      className={`rounded border p-2 ${
        pass
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-red-500/40 bg-red-500/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {pass ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-label="passing" />
        ) : (
          <AlertOctagon className="h-3 w-3 text-red-400" aria-label="breach" />
        )}
      </div>
      <p className={`mt-0.5 text-sm font-semibold ${pass ? "text-foreground" : "text-red-300"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">target {target}</p>
      {hasSeries && (
        <div className="mt-1.5">
          <SloSparkline
            values={series!}
            lowerIsBetter={seriesLowerIsBetter ?? true}
            target={seriesTarget!}
          />
        </div>
      )}
      {footnote && <p className="mt-0.5 text-[9px] text-muted-foreground/70">{footnote}</p>}
    </div>
  );
}
