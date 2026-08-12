import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, ClipboardList, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  cancelServicePlanPmDueEvent,
  listOpenServicePlanSchedulePrompts,
  listServicePlanPrograms,
  reviewServicePlanProgram,
  setServicePlanProgramActivation,
} from "../lib/service-plan-api";
import {
  canMutateServicePlans,
  formatServicePlanReviewStatus,
  getProgramActivationReadiness,
  provisionalProgramDisclosure,
  summarizeProgramInterval,
  type ServicePlanProgram,
  type ServicePlanReviewStatus,
} from "../lib/service-plan-utils";

const REVIEW_STYLES: Record<ServicePlanReviewStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  reviewed: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  changes_requested: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  retired: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function ServicePlansPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const canMutate = canMutateServicePlans(profile?.role);
  const workspaceId = profile?.active_workspace_id?.trim() || "default";
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [cancelReasonByPrompt, setCancelReasonByPrompt] = useState<Record<string, string>>({});

  const programsQuery = useQuery({
    queryKey: ["service-plan-programs"],
    queryFn: listServicePlanPrograms,
  });

  const promptsQuery = useQuery({
    queryKey: ["service-plan-schedule-prompts"],
    queryFn: listOpenServicePlanSchedulePrompts,
  });

  const programs = programsQuery.data ?? [];
  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === selectedProgramId) ?? programs[0] ?? null,
    [programs, selectedProgramId],
  );
  const activation = selectedProgram ? getProgramActivationReadiness(selectedProgram) : null;

  const reviewMutation = useMutation({
    mutationFn: async (program: ServicePlanProgram) => {
      if (!profile?.id) throw new Error("Sign in required to review programs.");
      if (!reviewNotes.trim()) throw new Error("Review notes are required.");
      return reviewServicePlanProgram({
        workspaceId,
        programId: program.id,
        reviewerId: profile.id,
        reviewNotes: reviewNotes.trim(),
      });
    },
    onSuccess: async () => {
      setReviewNotes("");
      await qc.invalidateQueries({ queryKey: ["service-plan-programs"] });
    },
  });

  const activationMutation = useMutation({
    mutationFn: async ({ program, isActive }: { program: ServicePlanProgram; isActive: boolean }) => {
      if (!profile?.id) throw new Error("Sign in required to change activation.");
      return setServicePlanProgramActivation({
        workspaceId,
        programId: program.id,
        isActive,
        actorId: profile.id,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-plan-programs"] });
    },
  });

  const cancelPromptMutation = useMutation({
    mutationFn: async ({ dueEventId, reason }: { dueEventId: string; reason: string }) => {
      if (!profile?.id) throw new Error("Sign in required to cancel PM due work.");
      if (!reason.trim()) throw new Error("Cancellation reason is required.");
      await cancelServicePlanPmDueEvent({
        workspaceId,
        dueEventId,
        cancellationKind: "cancelled",
        reason: reason.trim(),
        actorId: profile.id,
      });
    },
    onSuccess: async (_data, variables) => {
      setCancelReasonByPrompt((prev) => {
        const next = { ...prev };
        delete next[variables.dueEventId];
        return next;
      });
      await qc.invalidateQueries({ queryKey: ["service-plan-schedule-prompts"] });
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                H9.1 · Service plans
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                PM program catalog
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Review BlackRock draft cadences, activate only after QEP notes are recorded, then enroll
                machines from service agreements. Draft rows stay non-customer-live until that loop completes.
              </p>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <ClipboardList className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Programs", value: programs.length },
              { label: "Reviewed", value: programs.filter((row) => row.review_status === "reviewed").length },
              { label: "Active", value: programs.filter((row) => row.is_active).length },
            ].map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{metric.value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Activation boundary
            </p>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Review and activation are separate writes. OEM kits, prices, and labor times are not invented here.
            {!canMutate ? " Read-only for your role — elevated operators review and activate." : null}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Catalog
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Programs</h2>

          <div className="mt-4 space-y-3">
            {programsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading programs…</p>
            ) : programsQuery.isError ? (
              <p className="text-sm text-destructive">{(programsQuery.error as Error).message}</p>
            ) : programs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No service-plan programs in this workspace.</p>
            ) : (
              programs.map((program) => {
                const isSelected = (selectedProgram?.id ?? "") === program.id;
                return (
                  <button
                    key={program.id}
                    type="button"
                    onClick={() => setSelectedProgramId(program.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? "border-primary/30 bg-primary/[0.06]"
                        : "border-border/60 bg-background/60 hover:border-primary/20 hover:bg-background"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{program.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {program.program_code} · {program.catalog_owner ?? "No catalog owner"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${REVIEW_STYLES[program.review_status]}`}>
                          {formatServicePlanReviewStatus(program.review_status)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          program.is_active
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-500/10 text-slate-600 dark:text-slate-300"
                        }`}>
                          {program.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {program.intervals.filter((interval) => interval.is_active).map(summarizeProgramInterval).join(" · ") || "No active intervals"}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          {!selectedProgram ? (
            <p className="text-sm text-muted-foreground">Select a program to review or activate.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Selected program
                </p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{selectedProgram.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {provisionalProgramDisclosure(selectedProgram)}
                </p>
                {selectedProgram.description ? (
                  <p className="mt-2 text-sm text-muted-foreground">{selectedProgram.description}</p>
                ) : null}
              </div>

              <div className="space-y-2 rounded-2xl border border-border/50 bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Intervals
                </p>
                {selectedProgram.intervals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No intervals defined.</p>
                ) : (
                  selectedProgram.intervals.map((interval) => (
                    <div key={interval.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-foreground">{interval.name}</span>
                      <span className="text-muted-foreground">
                        {summarizeProgramInterval(interval)}
                        {!interval.is_active ? " · inactive" : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {selectedProgram.review_notes ? (
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Latest review notes
                  </p>
                  <p className="mt-2 text-foreground">{selectedProgram.review_notes}</p>
                </div>
              ) : null}

              {canMutate ? (
                <div className="space-y-3">
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="QEP review notes (required before activation)"
                    className="min-h-[96px] w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      disabled={reviewMutation.isPending || selectedProgram.is_active}
                      onClick={() => reviewMutation.mutate(selectedProgram)}
                    >
                      Record review
                    </Button>
                    {selectedProgram.is_active ? (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={activationMutation.isPending}
                        onClick={() => activationMutation.mutate({ program: selectedProgram, isActive: false })}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={activationMutation.isPending || !activation?.ready}
                        onClick={() => activationMutation.mutate({ program: selectedProgram, isActive: true })}
                      >
                        Activate
                      </Button>
                    )}
                  </div>
                  {activation && !activation.ready && !selectedProgram.is_active ? (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {activation.reasons.map((reason) => (
                        <li key={reason}>• {reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  {reviewMutation.isError ? (
                    <p className="text-sm text-destructive">{(reviewMutation.error as Error).message}</p>
                  ) : null}
                  {activationMutation.isError ? (
                    <p className="text-sm text-destructive">{(activationMutation.error as Error).message}</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Elevated role required to review or activate programs.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              PM prompt inbox
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Open schedule prompts</h2>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {promptsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading prompts…</p>
          ) : promptsQuery.isError ? (
            <p className="text-sm text-destructive">{(promptsQuery.error as Error).message}</p>
          ) : (promptsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open PM prompts. Due jobs appear here after enrolled equipment hits hour or calendar thresholds.
            </p>
          ) : (
            (promptsQuery.data ?? []).map((prompt) => (
              <div
                key={prompt.id}
                className="rounded-2xl border border-border/60 bg-background/60 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {prompt.job_number ? `Job ${prompt.job_number}` : "Generated PM job"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Due basis: {prompt.due_basis ?? "—"}
                      {prompt.due_on ? ` · calendar ${prompt.due_on}` : ""}
                      {prompt.due_hours != null ? ` · hours ${prompt.due_hours}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Status: {prompt.due_status ?? "unknown"}
                      {prompt.evidence.entitlement_reserved === true ? " · entitlement reserved" : ""}
                    </p>
                  </div>
                  <Link
                    to={`/service?job=${prompt.service_job_id}`}
                    className="inline-flex min-h-11 items-center rounded-xl border border-border/60 px-3 text-sm font-semibold text-primary"
                  >
                    Open job
                  </Link>
                </div>

                {canMutate ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={cancelReasonByPrompt[prompt.due_event_id] ?? ""}
                      onChange={(e) =>
                        setCancelReasonByPrompt((prev) => ({
                          ...prev,
                          [prompt.due_event_id]: e.target.value,
                        }))
                      }
                      placeholder="Cancellation reason"
                      className="min-h-11 flex-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                    />
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={cancelPromptMutation.isPending}
                      onClick={() =>
                        cancelPromptMutation.mutate({
                          dueEventId: prompt.due_event_id,
                          reason: cancelReasonByPrompt[prompt.due_event_id] ?? "",
                        })
                      }
                    >
                      Cancel due work
                    </Button>
                  </div>
                ) : null}
                {cancelPromptMutation.isError ? (
                  <p className="mt-2 text-sm text-destructive">
                    {(cancelPromptMutation.error as Error).message}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
