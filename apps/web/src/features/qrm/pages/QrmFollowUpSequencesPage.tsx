import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Pause, Play, Plus, Save, Slash, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { QrmPageHeader } from "../components/QrmPageHeader";
import {
  ALLOWED_SEQUENCE_TRIGGER_STAGES,
  listCrmFollowUpSequences,
  listCrmSequenceEnrollments,
  saveCrmFollowUpSequence,
  updateCrmSequenceEnrollmentStatus,
} from "../lib/qrm-follow-up-api";
import type {
  QrmEnrollmentStatus,
  QrmFollowUpSequence,
  QrmFollowUpSequenceEditorInput,
  QrmFollowUpStepType,
  QrmSequenceEnrollment,
} from "../lib/types";

interface QrmFollowUpSequencesPageProps {
  userId: string;
}

type StepEditor = QrmFollowUpSequenceEditorInput["steps"][number];

type SequenceEditorState = {
  id?: string;
  name: string;
  description: string;
  triggerStage: string;
  isActive: boolean;
  steps: StepEditor[];
};

const EMPTY_STEP: StepEditor = {
  stepNumber: 1,
  dayOffset: 0,
  stepType: "task",
  subject: "",
  bodyTemplate: "",
  taskPriority: "MEDIUM",
};

const EMPTY_EDITOR: SequenceEditorState = {
  name: "",
  description: "",
  triggerStage: "quote_sent",
  isActive: true,
  steps: [{ ...EMPTY_STEP }],
};

const STEP_TYPE_OPTIONS: Array<{ value: QrmFollowUpStepType; label: string }> = [
  { value: "task", label: "Task" },
  { value: "email", label: "Email" },
  { value: "call_log", label: "Call log" },
  { value: "stalled_alert", label: "Stalled alert" },
];

function toEditorState(sequence: QrmFollowUpSequence): SequenceEditorState {
  return {
    id: sequence.id,
    name: sequence.name,
    description: sequence.description ?? "",
    triggerStage: sequence.triggerStage,
    isActive: sequence.isActive,
    steps: sequence.steps.map((step) => ({
      id: step.id,
      stepNumber: step.stepNumber,
      dayOffset: step.dayOffset,
      stepType: step.stepType,
      subject: step.subject ?? "",
      bodyTemplate: step.bodyTemplate ?? "",
      taskPriority: step.taskPriority ?? "MEDIUM",
    })),
  };
}

function formatEnrollmentStatus(status: QrmEnrollmentStatus): string {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  return "Cancelled";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not scheduled";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Invalid date";
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function QrmFollowUpSequencesPage({ userId }: QrmFollowUpSequencesPageProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [editor, setEditor] = useState<SequenceEditorState>(EMPTY_EDITOR);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingEnrollmentId, setUpdatingEnrollmentId] = useState<string | null>(null);

  const sequencesQuery = useQuery({
    queryKey: ["crm", "follow-up-sequences"],
    queryFn: listCrmFollowUpSequences,
    staleTime: 30_000,
  });

  const enrollmentsQuery = useQuery({
    queryKey: ["crm", "follow-up-enrollments"],
    queryFn: listCrmSequenceEnrollments,
    staleTime: 15_000,
  });

  const sequences = sequencesQuery.data ?? [];
  const selectedSequence = useMemo(
    () => sequences.find((sequence) => sequence.id === selectedSequenceId) ?? null,
    [selectedSequenceId, sequences],
  );

  const selectedEnrollments = useMemo(() => {
    if (!selectedSequenceId) return enrollmentsQuery.data ?? [];
    return (enrollmentsQuery.data ?? []).filter((enrollment) => enrollment.sequenceId === selectedSequenceId);
  }, [enrollmentsQuery.data, selectedSequenceId]);

  function resetEditor(sequence?: QrmFollowUpSequence | null): void {
    setEditor(sequence ? toEditorState(sequence) : EMPTY_EDITOR);
    setSelectedSequenceId(sequence?.id ?? null);
    setSaveError(null);
  }

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["crm", "follow-up-sequences"] }),
      queryClient.invalidateQueries({ queryKey: ["crm", "follow-up-enrollments"] }),
    ]);
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);

    try {
      const normalizedSteps = editor.steps.map((step, index) => ({
        ...step,
        stepNumber: index + 1,
        dayOffset: Number(step.dayOffset),
        subject: step.subject?.trim() || null,
        bodyTemplate: step.bodyTemplate?.trim() || null,
      }));

      if (normalizedSteps.some((step) => !Number.isFinite(step.dayOffset) || step.dayOffset < 0)) {
        throw new Error("Every step needs a day offset of zero or greater.");
      }

      const saved = await saveCrmFollowUpSequence(
        {
          id: editor.id,
          name: editor.name,
          description: editor.description,
          triggerStage: editor.triggerStage,
          isActive: editor.isActive,
          steps: normalizedSteps,
        },
        userId,
      );

      await refresh();
      resetEditor(saved);
      toast({
        title: editor.id ? "Sequence updated" : "Sequence created",
        description: "Follow-up automation is ready for the scheduler and review queue.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save sequence.";
      setSaveError(message);
      toast({
        title: "Could not save sequence",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEnrollmentStatusChange(
    enrollment: QrmSequenceEnrollment,
    status: QrmEnrollmentStatus,
  ): Promise<void> {
    setUpdatingEnrollmentId(enrollment.id);
    try {
      await updateCrmSequenceEnrollmentStatus(enrollment.id, status);
      await refresh();
      toast({
        title: "Enrollment updated",
        description: `${enrollment.dealName ?? enrollment.dealId} is now ${formatEnrollmentStatus(status).toLowerCase()}.`,
      });
    } catch (error) {
      toast({
        title: "Could not update enrollment",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingEnrollmentId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="QRM Sequences"
        subtitle="Own the follow-up automation that keeps deals moving after the first quote goes out."
      />

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="space-y-4 rounded-2xl border border-border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Sequence library</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Activate the plays that should auto-enroll when a deal hits a trigger stage.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetEditor(null)}
              disabled={isSaving}
            >
              <Plus className="mr-2 h-4 w-4" />
              New sequence
            </Button>
          </div>

          {sequencesQuery.isLoading ? (
            <div className="space-y-3" role="status" aria-label="Loading follow-up sequences">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
              ))}
            </div>
          ) : sequencesQuery.isError ? (
            <Card className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
              Could not load follow-up sequences.
            </Card>
          ) : sequences.length === 0 ? (
            <Card className="rounded-xl border border-dashed border-input bg-muted/30 p-5 text-sm text-muted-foreground">
              No follow-up sequences yet.
            </Card>
          ) : (
            <div className="space-y-3">
              {sequences.map((sequence) => (
                <Card
                  key={sequence.id}
                  className={`rounded-xl border p-4 shadow-sm ${
                    selectedSequenceId === sequence.id ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{sequence.name}</p>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] backdrop-blur-md",
                            sequence.isActive
                              ? "border-emerald-400/45 bg-gradient-to-br from-emerald-400/20 to-emerald-950/12 text-emerald-950 dark:from-emerald-400/16 dark:to-emerald-950/35 dark:text-emerald-50"
                              : "border-slate-300/60 bg-gradient-to-br from-slate-200/60 to-slate-500/10 text-slate-800 dark:border-white/14 dark:from-white/[0.08] dark:to-white/[0.02] dark:text-slate-200",
                          )}
                        >
                          {sequence.isActive ? "Active" : "Paused"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Trigger stage: <span className="font-medium text-foreground">{sequence.triggerStage}</span>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {sequence.description || "No description added yet."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sequence.steps.map((step) => (
                          <span
                            key={step.id}
                            className="rounded-full border border-white/12 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-2 py-1 text-xs text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] backdrop-blur-md dark:border-white/10 dark:from-white/[0.06] dark:to-white/[0.02]"
                          >
                            Day {step.dayOffset} · {step.stepType.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => resetEditor(sequence)}
                      disabled={isSaving}
                    >
                      Edit
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>

        <Card className="rounded-2xl border border-border p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {editor.id ? "Edit sequence" : "New sequence"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Keep step timing and copy dealership-native and operator-safe.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetEditor(selectedSequence)}
              disabled={isSaving}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="crm-sequence-name">Sequence name</Label>
              <Input
                id="crm-sequence-name"
                value={editor.name}
                onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
                placeholder="Post-quote follow-up"
                disabled={isSaving}
              />
            </div>

            <div>
              <Label htmlFor="crm-sequence-description">Description</Label>
              <textarea
                id="crm-sequence-description"
                value={editor.description}
                onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
                className="min-h-[88px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                placeholder="What this sequence is for and when to use it."
                disabled={isSaving}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="crm-sequence-trigger-stage">Trigger stage</Label>
                <select
                  id="crm-sequence-trigger-stage"
                  value={editor.triggerStage}
                  onChange={(event) => setEditor((current) => ({ ...current, triggerStage: event.target.value }))}
                  className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                  disabled={isSaving}
                >
                  {ALLOWED_SEQUENCE_TRIGGER_STAGES.map((triggerStage) => (
                    <option key={triggerStage} value={triggerStage}>
                      {triggerStage}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 rounded-md border border-input px-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={editor.isActive}
                  onChange={(event) => setEditor((current) => ({ ...current, isActive: event.target.checked }))}
                  disabled={isSaving}
                />
                Active
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Steps</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() =>
                    setEditor((current) => ({
                      ...current,
                      steps: [
                        ...current.steps,
                        {
                          ...EMPTY_STEP,
                          stepNumber: current.steps.length + 1,
                          dayOffset: current.steps.length + 1,
                        },
                      ],
                    }))
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add step
                </Button>
              </div>

              {editor.steps.map((step, index) => (
                <Card key={step.id ?? `${index}-${step.stepType}`} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Step {index + 1}</p>
                    {editor.steps.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() =>
                          setEditor((current) => ({
                            ...current,
                            steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Day offset</Label>
                      <Input
                        inputMode="numeric"
                        value={String(step.dayOffset)}
                        disabled={isSaving}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            steps: current.steps.map((currentStep, stepIndex) =>
                              stepIndex === index
                                ? { ...currentStep, dayOffset: Number(event.target.value) }
                                : currentStep
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Step type</Label>
                      <select
                        value={step.stepType}
                        disabled={isSaving}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            steps: current.steps.map((currentStep, stepIndex) =>
                              stepIndex === index
                                ? { ...currentStep, stepType: event.target.value as QrmFollowUpStepType }
                                : currentStep
                            ),
                          }))
                        }
                        className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                      >
                        {STEP_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <Label>Subject</Label>
                      <Input
                        value={step.subject ?? ""}
                        disabled={isSaving}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            steps: current.steps.map((currentStep, stepIndex) =>
                              stepIndex === index
                                ? { ...currentStep, subject: event.target.value }
                                : currentStep
                            ),
                          }))
                        }
                        placeholder="Checking in on your quote"
                      />
                    </div>

                    <div>
                      <Label>Body or task notes</Label>
                      <textarea
                        value={step.bodyTemplate ?? ""}
                        disabled={isSaving}
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            steps: current.steps.map((currentStep, stepIndex) =>
                              stepIndex === index
                                ? { ...currentStep, bodyTemplate: event.target.value }
                                : currentStep
                            ),
                          }))
                        }
                        className="min-h-[88px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
                        placeholder="Use {{contact_name}}, {{deal_name}}, and {{rep_name}} where needed."
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

            <div className="flex justify-end">
              <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Saving..." : editor.id ? "Save sequence" : "Create sequence"}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className="rounded-2xl border border-border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Live enrollments</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              See which deals are in motion and pause, resume, or cancel them before the scheduler runs the next step.
            </p>
          </div>
          <div className="rounded-full border border-white/12 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-3 py-1 text-sm text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] backdrop-blur-md dark:border-white/10 dark:from-white/[0.06] dark:to-white/[0.02]">
            {selectedEnrollments.length} visible
          </div>
        </div>

        {enrollmentsQuery.isLoading ? (
          <div className="mt-4 space-y-3" role="status" aria-label="Loading sequence enrollments">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
        ) : enrollmentsQuery.isError ? (
          <Card className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
            Could not load active enrollments.
          </Card>
        ) : selectedEnrollments.length === 0 ? (
          <Card className="mt-4 rounded-xl border border-dashed border-input bg-muted/30 p-5 text-sm text-muted-foreground">
            No enrollments are visible for this filter yet.
          </Card>
        ) : (
          <div className="mt-4 space-y-3">
            {selectedEnrollments.map((enrollment) => (
              <Card key={enrollment.id} className="rounded-xl border border-border p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {enrollment.dealName ?? enrollment.dealId}
                      </p>
                      <span className="rounded-full border border-white/12 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-2 py-0.5 text-xs text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] backdrop-blur-md dark:border-white/10 dark:from-white/[0.06] dark:to-white/[0.02]">
                        {enrollment.sequenceName}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)] backdrop-blur-md",
                          enrollment.status === "active"
                            ? "border-emerald-400/45 bg-gradient-to-br from-emerald-400/20 to-emerald-950/12 text-emerald-950 dark:from-emerald-400/16 dark:to-emerald-950/35 dark:text-emerald-50"
                            : enrollment.status === "paused"
                              ? "border-amber-400/45 bg-gradient-to-br from-amber-400/20 to-amber-950/12 text-amber-950 dark:from-amber-400/16 dark:to-amber-950/35 dark:text-amber-50"
                              : enrollment.status === "completed"
                                ? "border-slate-300/60 bg-gradient-to-br from-slate-200/55 to-slate-500/10 text-slate-800 dark:border-white/14 dark:from-white/[0.08] dark:to-white/[0.02] dark:text-slate-200"
                                : "border-rose-400/45 bg-gradient-to-br from-rose-400/20 to-rose-950/12 text-rose-950 dark:from-rose-400/16 dark:to-rose-950/35 dark:text-rose-50",
                        )}
                      >
                        {formatEnrollmentStatus(enrollment.status)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span>Contact: {enrollment.contactName ?? "Not linked"}</span>
                      <span>Hub: {enrollment.hubId}</span>
                      <span>Step {enrollment.currentStep}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-4 w-4" />
                        Next due {formatTimestamp(enrollment.nextStepDueAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {enrollment.status !== "paused" && enrollment.status !== "cancelled" && enrollment.status !== "completed" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={updatingEnrollmentId === enrollment.id}
                        onClick={() => void handleEnrollmentStatusChange(enrollment, "paused")}
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        Pause
                      </Button>
                    ) : null}

                    {enrollment.status === "paused" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={updatingEnrollmentId === enrollment.id}
                        onClick={() => void handleEnrollmentStatusChange(enrollment, "active")}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Resume
                      </Button>
                    ) : null}

                    {enrollment.status !== "cancelled" && enrollment.status !== "completed" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={updatingEnrollmentId === enrollment.id}
                        onClick={() => void handleEnrollmentStatusChange(enrollment, "cancelled")}
                      >
                        <Slash className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
