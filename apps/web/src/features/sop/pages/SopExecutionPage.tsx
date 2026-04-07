import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CheckCircle2, SkipForward, Clock, ShieldCheck, GitBranch, Loader2, Flag,
} from "lucide-react";
import {
  fetchExecutionContext,
  completeStep,
  skipStep,
  closeExecution,
  markStepNotApplicable,
  type SopStep,
  type SopStepCompletion,
} from "../lib/sop-api";

export function SopExecutionPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const queryClient = useQueryClient();
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState("");
  const [skipReason, setSkipReason] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sop", "execution", executionId],
    queryFn: () => fetchExecutionContext(executionId!),
    enabled: !!executionId,
    staleTime: 15_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sop", "execution", executionId] });

  const completeMutation = useMutation({
    mutationFn: (stepId: string) =>
      completeStep(executionId!, {
        sop_step_id: stepId,
        notes: notes || undefined,
        decision_taken: decision || undefined,
      }),
    onSuccess: () => {
      setActiveStepId(null);
      setNotes("");
      setDecision("");
      invalidate();
    },
  });

  const skipMutation = useMutation({
    mutationFn: (stepId: string) =>
      skipStep(executionId!, {
        sop_step_id: stepId,
        skip_reason: skipReason || undefined,
      }),
    onSuccess: () => {
      setActiveStepId(null);
      setSkipReason("");
      invalidate();
    },
  });

  const closeMutation = useMutation({
    mutationFn: (status: "completed" | "abandoned") =>
      closeExecution(executionId!, { status }),
    onSuccess: () => invalidate(),
  });

  // Phase 2E: Not Applicable path — does NOT count against compliance.
  const naMutation = useMutation({
    mutationFn: (input: { stepId: string; reason: string }) =>
      markStepNotApplicable(executionId!, input.stepId, input.reason),
    onSuccess: () => {
      setActiveStepId(null);
      setSkipReason("");
      invalidate();
    },
  });

  const completionByStep = useMemo(() => {
    const map = new Map<string, SopStepCompletion>();
    for (const c of data?.completions ?? []) map.set(c.sop_step_id, c);
    return map;
  }, [data?.completions]);

  const skippedSet = useMemo(
    () => new Set(data?.skipped_step_ids ?? []),
    [data?.skipped_step_ids],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <Card className="h-64 animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load execution.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/sop/templates">
              <ArrowLeft className="mr-1 h-3 w-3" /> Back to templates
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { execution, template, steps } = data;
  const totalSteps = steps.length;
  const completedCount = completionByStep.size;
  const skippedCount = skippedSet.size;
  const progressPct = totalSteps > 0 ? Math.round(((completedCount + skippedCount) / totalSteps) * 100) : 0;
  const allResolved = completedCount + skippedCount >= totalSteps && totalSteps > 0;
  const isOpen = execution.status === "in_progress";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <Button asChild variant="ghost" size="sm" className="h-7 text-[11px] mb-2">
          <Link to="/sop/templates">
            <ArrowLeft className="mr-1 h-3 w-3" aria-hidden />
            Back to templates
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                execution.status === "in_progress" ? "bg-blue-500/10 text-blue-400" :
                execution.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                execution.status === "blocked" ? "bg-amber-500/10 text-amber-400" :
                "bg-muted text-muted-foreground"
              }`}>
                {execution.status.replace(/_/g, " ")}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {template.department}
              </span>
              <span className="text-[10px] text-muted-foreground">v{template.version}</span>
            </div>
            <h1 className="mt-1 truncate text-xl font-bold text-foreground">{template.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Started {new Date(execution.started_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isOpen && allResolved && (
              <Button
                size="sm"
                onClick={() => closeMutation.mutate("completed")}
                disabled={closeMutation.isPending}
              >
                <Flag className="mr-1 h-3 w-3" aria-hidden />
                {closeMutation.isPending ? "Closing…" : "Close execution"}
              </Button>
            )}
            {isOpen && !allResolved && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => closeMutation.mutate("abandoned")}
                disabled={closeMutation.isPending}
              >
                Abandon
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Progress</h2>
          <span className="text-xs text-muted-foreground">
            {completedCount} done · {skippedCount} skipped · {totalSteps - completedCount - skippedCount} remaining
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-qep-orange transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{progressPct}% complete</p>
      </Card>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => {
          const completion = completionByStep.get(step.id);
          const isSkipped = skippedSet.has(step.id);
          const isActive = activeStepId === step.id;
          const isDone = !!completion || isSkipped;

          return (
            <ExecutionStepCard
              key={step.id}
              step={step}
              index={i + 1}
              completion={completion}
              isSkipped={isSkipped}
              isActive={isActive}
              isDone={isDone}
              canAct={isOpen && !isDone}
              notes={notes}
              decision={decision}
              skipReason={skipReason}
              onToggle={() => {
                if (isDone) return;
                setActiveStepId(isActive ? null : step.id);
                setNotes("");
                setDecision("");
                setSkipReason("");
              }}
              onNotesChange={setNotes}
              onDecisionChange={setDecision}
              onSkipReasonChange={setSkipReason}
              onComplete={() => completeMutation.mutate(step.id)}
              onSkip={() => skipMutation.mutate(step.id)}
              onMarkNotApplicable={() => naMutation.mutate({
                stepId: step.id,
                reason: skipReason || "Not applicable for this execution",
              })}
              isCompleting={completeMutation.isPending && completeMutation.variables === step.id}
              isSkipping={skipMutation.isPending && skipMutation.variables === step.id}
              isMarkingNa={naMutation.isPending && naMutation.variables?.stepId === step.id}
            />
          );
        })}
      </div>

      {(completeMutation.isError || skipMutation.isError || closeMutation.isError || naMutation.isError) && (
        <Card className="border-red-500/20 p-3">
          <p className="text-xs text-red-400">
            {((completeMutation.error || skipMutation.error || closeMutation.error || naMutation.error) as Error)?.message ?? "Action failed"}
          </p>
        </Card>
      )}
    </div>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function ExecutionStepCard({
  step, index, completion, isSkipped, isActive, isDone, canAct,
  notes, decision, skipReason,
  onToggle, onNotesChange, onDecisionChange, onSkipReasonChange,
  onComplete, onSkip, onMarkNotApplicable, isCompleting, isSkipping, isMarkingNa,
}: {
  step: SopStep;
  index: number;
  completion?: SopStepCompletion;
  isSkipped: boolean;
  isActive: boolean;
  isDone: boolean;
  canAct: boolean;
  notes: string;
  decision: string;
  skipReason: string;
  onToggle: () => void;
  onNotesChange: (v: string) => void;
  onDecisionChange: (v: string) => void;
  onSkipReasonChange: (v: string) => void;
  onComplete: () => void;
  onSkip: () => void;
  onMarkNotApplicable: () => void;
  isCompleting: boolean;
  isSkipping: boolean;
  isMarkingNa: boolean;
}) {
  return (
    <Card className={`p-3 ${isDone ? "opacity-70" : ""} ${isActive ? "border-qep-orange" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!canAct && !isActive}
        className="w-full text-left"
      >
        <div className="flex items-start gap-3">
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            completion ? "bg-emerald-500/10 text-emerald-400" :
            isSkipped ? "bg-muted text-muted-foreground" :
            "bg-qep-orange/10 text-qep-orange"
          }`}>
            {completion ? <CheckCircle2 className="h-3 w-3" /> : isSkipped ? <SkipForward className="h-3 w-3" /> : index}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground">{step.title}</p>
              {step.is_decision_point && (
                <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400">
                  <GitBranch className="h-2.5 w-2.5" aria-hidden />
                  Decision
                </span>
              )}
              {isSkipped && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  Skipped
                </span>
              )}
              {completion && (
                <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                  Done
                </span>
              )}
            </div>
            {step.instructions && (
              <p className="mt-1 text-xs text-muted-foreground">{step.instructions}</p>
            )}
            <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
              {step.required_role && (
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-2.5 w-2.5" aria-hidden />
                  {step.required_role.replace(/_/g, " ")}
                </span>
              )}
              {step.estimated_duration_minutes && (
                <span className="flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" aria-hidden />
                  {step.estimated_duration_minutes} min
                </span>
              )}
            </div>
            {completion?.notes && (
              <p className="mt-1 text-[11px] italic text-muted-foreground">“{completion.notes}”</p>
            )}
          </div>
        </div>
      </button>

      {isActive && canAct && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {step.is_decision_point && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Decision taken
              </label>
              <input
                type="text"
                value={decision}
                onChange={(e) => onDecisionChange(e.target.value)}
                placeholder="e.g. Approved for credit"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
          )}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={2}
              placeholder="What happened, what was verified…"
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Skip reason (if skipping)
            </label>
            <input
              type="text"
              value={skipReason}
              onChange={(e) => onSkipReasonChange(e.target.value)}
              placeholder="e.g. Not applicable for this deal"
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onMarkNotApplicable}
              disabled={isMarkingNa || isSkipping || isCompleting}
              title="This step doesn't apply here. Excluded from compliance counts."
            >
              {isMarkingNa ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Not applicable
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onSkip}
              disabled={isSkipping || isCompleting || isMarkingNa}
            >
              {isSkipping ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <SkipForward className="mr-1 h-3 w-3" />}
              Skip
            </Button>
            <Button
              size="sm"
              onClick={onComplete}
              disabled={isCompleting || isSkipping || isMarkingNa}
            >
              {isCompleting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              Complete step
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
