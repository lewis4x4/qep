import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Plus, Play, CheckCircle2, Clock, GitBranch, ShieldCheck, Edit,
} from "lucide-react";
import {
  fetchTemplateWithSteps,
  addSopStep,
  publishSopTemplate,
  startSopExecution,
  type SopStep,
} from "../lib/sop-api";

export function SopTemplateEditorPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const queryClient = useQueryClient();
  const [showAddStep, setShowAddStep] = useState(false);
  const [newStep, setNewStep] = useState<{
    title: string;
    instructions: string;
    required_role: string;
    estimated_duration_minutes: string;
    is_decision_point: boolean;
  }>({
    title: "",
    instructions: "",
    required_role: "",
    estimated_duration_minutes: "",
    is_decision_point: false,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sop", "template", templateId],
    queryFn: () => fetchTemplateWithSteps(templateId!),
    enabled: !!templateId,
    staleTime: 30_000,
  });

  const addStepMutation = useMutation({
    mutationFn: () =>
      addSopStep(templateId!, {
        title: newStep.title,
        sort_order: (data?.steps.length ?? 0) + 1,
        instructions: newStep.instructions || undefined,
        required_role: newStep.required_role || undefined,
        estimated_duration_minutes: newStep.estimated_duration_minutes
          ? parseInt(newStep.estimated_duration_minutes, 10)
          : undefined,
        is_decision_point: newStep.is_decision_point,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sop", "template", templateId] });
      setShowAddStep(false);
      setNewStep({ title: "", instructions: "", required_role: "", estimated_duration_minutes: "", is_decision_point: false });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishSopTemplate(templateId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sop", "template", templateId] });
      queryClient.invalidateQueries({ queryKey: ["sop", "templates"] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startSopExecution({
        sop_template_id: templateId!,
      }),
    onSuccess: (result) => {
      window.location.href = `/sop/executions/${result.execution.id}`;
    },
  });

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
          <p className="text-sm text-red-400">Failed to load template.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/sop/templates">
              <ArrowLeft className="mr-1 h-3 w-3" /> Back to list
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { template, steps } = data;
  const isDraft = template.status === "draft";
  const isActive = template.status === "active";

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
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                isDraft ? "bg-amber-500/10 text-amber-400" :
                isActive ? "bg-emerald-500/10 text-emerald-400" :
                "bg-muted text-muted-foreground"
              }`}>
                {template.status}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {template.department}
              </span>
              <span className="text-[10px] text-muted-foreground">v{template.version}</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-foreground">{template.title}</h1>
            {template.description && (
              <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDraft && steps.length > 0 && (
              <Button
                size="sm"
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                {publishMutation.isPending ? "Publishing…" : "Publish"}
              </Button>
            )}
            {isActive && (
              <Button
                size="sm"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                <Play className="mr-1 h-3 w-3" aria-hidden />
                {startMutation.isPending ? "Starting…" : "Start execution"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {publishMutation.isError && (
        <Card className="border-red-500/20 p-3">
          <p className="text-xs text-red-400">
            {(publishMutation.error as Error)?.message ?? "Publish failed"}
          </p>
        </Card>
      )}

      {/* Steps list */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground">Steps ({steps.length})</h2>
          {isDraft && (
            <Button size="sm" variant="outline" onClick={() => setShowAddStep((v) => !v)}>
              <Plus className="mr-1 h-3 w-3" aria-hidden />
              Add step
            </Button>
          )}
        </div>

        {steps.length === 0 && !showAddStep && (
          <div className="rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No steps yet. Add steps to build the workflow.</p>
          </div>
        )}

        <div className="space-y-2">
          {steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i + 1} />
          ))}
        </div>

        {/* Add-step form */}
        {showAddStep && isDraft && (
          <div className="mt-4 rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <h3 className="text-xs font-bold text-foreground">New step</h3>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Title</label>
              <input
                type="text"
                value={newStep.title}
                onChange={(e) => setNewStep((s) => ({ ...s, title: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                placeholder="e.g. Verify customer credit application"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Instructions</label>
              <textarea
                value={newStep.instructions}
                onChange={(e) => setNewStep((s) => ({ ...s, instructions: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                placeholder="Detailed step instructions…"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Required role</label>
                <select
                  value={newStep.required_role}
                  onChange={(e) => setNewStep((s) => ({ ...s, required_role: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                >
                  <option value="">Any role</option>
                  <option value="iron_advisor">Iron Advisor</option>
                  <option value="iron_woman">Iron Woman</option>
                  <option value="iron_man">Iron Man</option>
                  <option value="iron_manager">Iron Manager</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Est. duration (min)</label>
                <input
                  type="number"
                  min={1}
                  value={newStep.estimated_duration_minutes}
                  onChange={(e) => setNewStep((s) => ({ ...s, estimated_duration_minutes: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={newStep.is_decision_point}
                onChange={(e) => setNewStep((s) => ({ ...s, is_decision_point: e.target.checked }))}
              />
              Decision point (branching logic)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAddStep(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => addStepMutation.mutate()}
                disabled={!newStep.title.trim() || addStepMutation.isPending}
              >
                {addStepMutation.isPending ? "Adding…" : "Add step"}
              </Button>
            </div>
            {addStepMutation.isError && (
              <p className="text-xs text-red-400">
                {(addStepMutation.error as Error)?.message ?? "Failed to add step"}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function StepRow({ step, index }: { step: SopStep; index: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-qep-orange/10 text-[10px] font-bold text-qep-orange">
          {index}
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
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-[11px] shrink-0" disabled>
          <Edit className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
