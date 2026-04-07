/**
 * Flow run history drawer — opens on a workflow row click in FlowAdminPage.
 * Shows the run trace (steps, status per step, timing), the resolved
 * context blob, and a button to drill the run into chat for "why did this
 * fail" Q&A.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Loader2, Clock, AlertOctagon, Check } from "lucide-react";
import { AskIronAdvisorButton, StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";

export interface FlowRunRow {
  id: string;
  workflow_slug: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_text: string | null;
  resolved_context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  dead_letter_id: string | null;
  event_id: string | null;
}

interface StepRow {
  id: string;
  step_index: number;
  step_type: string;
  action_key: string | null;
  status: string;
  result: Record<string, unknown> | null;
  error_text: string | null;
  started_at: string;
  finished_at: string | null;
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

interface Props {
  run: FlowRunRow | null;
  onClose: () => void;
}

export function FlowRunHistoryDrawer({ run, onClose }: Props) {
  const [showContext, setShowContext] = useState(false);

  const { data: steps = [], isLoading } = useQuery({
    enabled: !!run,
    queryKey: ["flow-run-steps", run?.id],
    queryFn: async (): Promise<StepRow[]> => {
      if (!run) return [];
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => {
              order: (c: string, o: { ascending: boolean }) => Promise<{ data: StepRow[] | null; error: unknown }>;
            };
          };
        };
      }).from("flow_workflow_run_steps")
        .select("*")
        .eq("run_id", run.id)
        .order("step_index", { ascending: true });
      if (error) throw new Error("steps load failed");
      return data ?? [];
    },
  });

  if (!run) return null;

  return (
    <Sheet open={!!run} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {run.workflow_slug}
            <AskIronAdvisorButton contextType="flow_run" contextId={run.id} variant="inline" />
          </SheetTitle>
          <SheetDescription>
            {run.status} · started {new Date(run.started_at).toLocaleString()}
            {run.duration_ms != null && ` · ${run.duration_ms}ms`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {/* Status banner */}
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <StatusChipStack chips={[
                { label: run.status.replace(/_/g, " "), tone: STATUS_TONE[run.status] ?? "neutral" },
                { label: `event ${run.event_id?.slice(0, 8) ?? "—"}`, tone: "neutral" },
              ]} />
              {run.dead_letter_id && (
                <span className="inline-flex items-center gap-1 text-[10px] text-red-400">
                  <AlertOctagon className="h-2.5 w-2.5" /> dead-lettered
                </span>
              )}
            </div>
            {run.error_text && (
              <p className="mt-2 rounded bg-red-500/5 p-2 text-[11px] text-red-400">{run.error_text}</p>
            )}
          </Card>

          {/* Step trace */}
          <Card className="p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Step trace</p>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">No steps recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {steps.map((step) => {
                  const tone =
                    step.status === "succeeded" ? "green" :
                    step.status === "failed" ? "red" :
                    step.status === "skipped" ? "neutral" :
                    step.status === "pending_approval" ? "purple" :
                    "blue";
                  const dur = step.finished_at && step.started_at
                    ? new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()
                    : null;
                  return (
                    <div key={step.id} className="rounded border border-border/60 bg-muted/10 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground">#{step.step_index}</span>
                          <span className="text-[11px] font-semibold text-foreground">
                            {step.action_key ?? step.step_type}
                          </span>
                        </div>
                        <StatusChipStack chips={[{ label: step.status.replace(/_/g, " "), tone: tone as never }]} />
                      </div>
                      {dur != null && (
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" /> {dur}ms
                        </p>
                      )}
                      {step.error_text && (
                        <p className="mt-1 text-[10px] text-red-400">{step.error_text}</p>
                      )}
                      {step.result != null && Object.keys(step.result).length > 0 && (
                        <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/30 p-1 text-[9px] text-muted-foreground">
                          {JSON.stringify(step.result, null, 0)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Resolved context (collapsed by default) */}
          <Card className="p-3">
            <button
              type="button"
              onClick={() => setShowContext((p) => !p)}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Resolved context {showContext ? "▼" : "▶"}
            </button>
            {showContext && run.resolved_context && (
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-[10px] text-foreground">
                {JSON.stringify(run.resolved_context, null, 2)}
              </pre>
            )}
          </Card>

          {run.status === "succeeded" && (
            <p className="text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="h-3 w-3" /> All steps succeeded
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
