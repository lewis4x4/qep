import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, ClipboardCheck, Loader2, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { WorkforceSubNav } from "../components/WorkforceSubNav";
import {
  acknowledgeAppraisal,
  APPRAISAL_REVIEW_TYPES,
  calculateAppraisalRollup,
  canManageWorkforce,
  createAppraisal,
  fetchAppraisal,
  fetchAppraisals,
  fetchScorecards,
  fetchWorkforceEmployees,
  filterManageableEmployees,
  finalizeAppraisal,
  formatPercent,
  formatRoleLabel,
  parseListText,
  SCORECARD_ROLES,
  scoreAppraisal,
  scoreToBand,
  type AppraisalReviewType,
  type AppraisalScore,
  type PerformanceAppraisal,
  type ScorecardRole,
} from "../lib/workforce-api";

type ScoreDraft = Record<string, { score: string; notes: string }>;

const today = new Date().toISOString().slice(0, 10);
const yearStart = `${new Date().getFullYear()}-01-01`;

function bandTone(band: string | null | undefined): string {
  if (band === "Excellent") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (band === "Normal") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (band === "Sub-Par") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-border bg-muted/40 text-muted-foreground";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function employeeLabel(employee: { display_name: string | null; employee_number: string | null }): string {
  return employee.display_name || employee.employee_number || "Unnamed employee";
}

function scoresFromAppraisal(appraisal: PerformanceAppraisal | null | undefined): ScoreDraft {
  const draft: ScoreDraft = {};
  for (const score of appraisal?.scores ?? []) {
    draft[score.category_key] = {
      score: score.score == null ? "" : String(score.score),
      notes: score.notes ?? "",
    };
  }
  return draft;
}

function normalizeScoreValue(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return null;
  return parsed;
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="border-dashed p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldCheck className="h-5 w-5" />
      </div>
      <h2 className="mt-3 text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Workforce data did not load.</p>
          <p className="mt-1 text-xs opacity-90">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export function WorkforcePerformanceAppraisalsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const role = profile?.role ?? "";
  const canManage = canManageWorkforce(role);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scorecardRole, setScorecardRole] = useState<ScorecardRole>("technician");
  const [scoreDraft, setScoreDraft] = useState<ScoreDraft>({});
  const [managerSummary, setManagerSummary] = useState("");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [goals, setGoals] = useState("");
  const [colRaise, setColRaise] = useState("0");
  const [managerSignature, setManagerSignature] = useState(profile?.full_name ?? "");
  const [employeeSignature, setEmployeeSignature] = useState(profile?.full_name ?? "");
  const [employeeComments, setEmployeeComments] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    subject_employee_id: "",
    review_type: "Annual Performance Review" as AppraisalReviewType,
    review_period_start: yearStart,
    review_period_end: today,
    cost_of_living_raise_pct: "0",
    manager_summary: "",
  });

  const appraisalsQuery = useQuery({ queryKey: ["workforce", "appraisals"], queryFn: fetchAppraisals });
  const scorecardsQuery = useQuery({ queryKey: ["workforce", "scorecards"], queryFn: fetchScorecards });
  const employeesQuery = useQuery({
    queryKey: ["workforce", "employees"],
    queryFn: fetchWorkforceEmployees,
    enabled: canManage,
  });
  const detailQuery = useQuery({
    queryKey: ["workforce", "appraisal", selectedId],
    queryFn: () => fetchAppraisal(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const appraisals = appraisalsQuery.data ?? [];
  const selectedAppraisal = detailQuery.data ?? appraisals.find((appraisal) => appraisal.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && appraisals.length > 0) {
      setSelectedId(appraisals[0].id);
    }
  }, [appraisals, selectedId]);

  useEffect(() => {
    if (!selectedAppraisal) return;
    setScorecardRole(selectedAppraisal.scorecard_role);
    setScoreDraft(scoresFromAppraisal(selectedAppraisal));
    setManagerSummary(selectedAppraisal.manager_summary ?? "");
    setStrengths((selectedAppraisal.key_strengths ?? []).join("\n"));
    setImprovements((selectedAppraisal.improvement_areas ?? []).join("\n"));
    setGoals((selectedAppraisal.goals_next_period ?? []).join("\n"));
    setColRaise(String(selectedAppraisal.cost_of_living_raise_pct ?? 0));
    setManagerSignature(selectedAppraisal.manager_signature_name ?? profile?.full_name ?? "");
    setEmployeeSignature(selectedAppraisal.employee_signature_name ?? profile?.full_name ?? "");
    setEmployeeComments(selectedAppraisal.employee_comments ?? "");
    setActionError(null);
  }, [profile?.full_name, selectedAppraisal]);

  const manageableEmployees = useMemo(
    () => filterManageableEmployees(employeesQuery.data ?? [], profile?.id, role),
    [employeesQuery.data, profile?.id, role],
  );

  useEffect(() => {
    if (!createForm.subject_employee_id && manageableEmployees.length > 0) {
      setCreateForm((current) => ({ ...current, subject_employee_id: manageableEmployees[0].id }));
    }
  }, [createForm.subject_employee_id, manageableEmployees]);

  const selectedCategories: AppraisalScore[] = useMemo(() => {
    if (selectedAppraisal?.scores.length) return selectedAppraisal.scores;
    return (scorecardsQuery.data ?? [])
      .filter((category) => category.scorecard_role === scorecardRole)
      .map((category) => ({ ...category, score: null, band: null, notes: null }));
  }, [scorecardRole, scorecardsQuery.data, selectedAppraisal?.scores]);

  const rollup = useMemo(() => {
    const scoreValues = selectedCategories.map((category) => normalizeScoreValue(scoreDraft[category.category_key]?.score ?? ""));
    return calculateAppraisalRollup(scoreValues, Number(colRaise));
  }, [colRaise, scoreDraft, selectedCategories]);

  const createMutation = useMutation({
    mutationFn: createAppraisal,
    onSuccess: async (appraisalId) => {
      setSelectedId(appraisalId);
      await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisals"] });
      await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisal", appraisalId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: scoreAppraisal,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisals"] });
      if (selectedId) await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisal", selectedId] });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: finalizeAppraisal,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisals"] });
      if (selectedId) await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisal", selectedId] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeAppraisal,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisals"] });
      if (selectedId) await queryClient.invalidateQueries({ queryKey: ["workforce", "appraisal", selectedId] });
    },
  });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    try {
      await createMutation.mutateAsync({
        subject_employee_id: createForm.subject_employee_id,
        review_type: createForm.review_type,
        review_period_start: createForm.review_period_start,
        review_period_end: createForm.review_period_end,
        scorecard_role: scorecardRole,
        cost_of_living_raise_pct: Number(createForm.cost_of_living_raise_pct || 0),
        manager_summary: createForm.manager_summary || null,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create appraisal.");
    }
  }

  function buildScorePayload() {
    if (!selectedAppraisal) throw new Error("Select an appraisal first.");
    if (selectedCategories.length !== 7) throw new Error("Exactly seven scorecard categories are required.");
    const scores = selectedCategories.map((category) => {
      const score = normalizeScoreValue(scoreDraft[category.category_key]?.score ?? "");
      if (score == null) throw new Error("Every category needs a whole-number score from 1 to 10.");
      return {
        category_key: category.category_key,
        score,
        notes: scoreDraft[category.category_key]?.notes?.trim() || null,
      };
    });
    return {
      appraisal_id: selectedAppraisal.id,
      scores,
      manager_summary: managerSummary.trim() || null,
      cost_of_living_raise_pct: Number(colRaise || 0),
      key_strengths: parseListText(strengths),
      improvement_areas: parseListText(improvements),
      goals_next_period: parseListText(goals),
    };
  }

  async function handleSave() {
    setActionError(null);
    try {
      await saveMutation.mutateAsync(buildScorePayload());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save scores.");
    }
  }

  async function handleFinalize() {
    setActionError(null);
    try {
      await saveMutation.mutateAsync(buildScorePayload());
      if (!selectedAppraisal) throw new Error("Select an appraisal first.");
      await finalizeMutation.mutateAsync({
        appraisal_id: selectedAppraisal.id,
        manager_summary: managerSummary.trim(),
        manager_signature_name: managerSignature.trim(),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to finalize appraisal.");
    }
  }

  async function handleAcknowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    try {
      if (!selectedAppraisal) throw new Error("Select an appraisal first.");
      await acknowledgeMutation.mutateAsync({
        appraisal_id: selectedAppraisal.id,
        employee_signature_name: employeeSignature.trim(),
        employee_comments: employeeComments.trim() || null,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to acknowledge appraisal.");
    }
  }

  const anyMutationPending = createMutation.isPending || saveMutation.isPending || finalizeMutation.isPending || acknowledgeMutation.isPending;
  const loading = appraisalsQuery.isLoading || scorecardsQuery.isLoading || (canManage && employeesQuery.isLoading);
  const error = appraisalsQuery.error ?? scorecardsQuery.error ?? employeesQuery.error ?? detailQuery.error;
  const canAcknowledge = selectedAppraisal?.status === "finalized" && selectedAppraisal.subject_profile_id === profile?.id && !selectedAppraisal.employee_acknowledged_at;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Performance appraisals</h1>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            HR-scoped 90-Day, Annual, and Merit reviews for Service Advisors and Technicians. Empty results mean nothing is assigned or visible under RLS — not a broken workflow.
          </p>
        </div>
        <WorkforceSubNav />
      </div>

      {error ? <ErrorState message={error instanceof Error ? error.message : "Unknown error"} /> : null}
      {actionError ? <ErrorState message={actionError} /> : null}
      {loading ? <LoadingBlock label="Loading RLS-scoped appraisal workspace…" /> : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          {canManage ? (
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <PenLine className="h-4 w-4 text-qep-orange" />
                <h2 className="text-sm font-bold text-foreground">Create appraisal</h2>
              </div>
              <form className="mt-4 space-y-3" onSubmit={handleCreate}>
                <label className="block text-xs font-semibold text-muted-foreground">
                  Employee
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={createForm.subject_employee_id}
                    onChange={(event) => setCreateForm((current) => ({ ...current, subject_employee_id: event.target.value }))}
                    required
                  >
                    {manageableEmployees.length === 0 ? <option value="">No direct reports visible</option> : null}
                    {manageableEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Review type
                    <select
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={createForm.review_type}
                      onChange={(event) => setCreateForm((current) => ({ ...current, review_type: event.target.value as AppraisalReviewType }))}
                    >
                      {APPRAISAL_REVIEW_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Scorecard
                    <select
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={scorecardRole}
                      onChange={(event) => setScorecardRole(event.target.value as ScorecardRole)}
                    >
                      {SCORECARD_ROLES.map((roleOption) => <option key={roleOption.value} value={roleOption.value}>{roleOption.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-muted-foreground">
                    Start
                    <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" type="date" value={createForm.review_period_start} onChange={(event) => setCreateForm((current) => ({ ...current, review_period_start: event.target.value }))} required />
                  </label>
                  <label className="block text-xs font-semibold text-muted-foreground">
                    End
                    <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" type="date" value={createForm.review_period_end} onChange={(event) => setCreateForm((current) => ({ ...current, review_period_end: event.target.value }))} required />
                  </label>
                </div>
                <label className="block text-xs font-semibold text-muted-foreground">
                  Cost of living %
                  <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" type="number" min="0" step="0.25" value={createForm.cost_of_living_raise_pct} onChange={(event) => setCreateForm((current) => ({ ...current, cost_of_living_raise_pct: event.target.value }))} />
                </label>
                <Button className="w-full" type="submit" disabled={anyMutationPending || manageableEmployees.length === 0}>
                  {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Start review
                </Button>
              </form>
            </Card>
          ) : null}

          <Card className="p-4">
            <h2 className="text-sm font-bold text-foreground">Visible appraisal queue</h2>
            <div className="mt-3 space-y-2">
              {appraisals.length === 0 && !loading ? (
                <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Nothing assigned or visible for your role yet.</p>
              ) : null}
              {appraisals.map((appraisal) => (
                <button
                  key={appraisal.id}
                  type="button"
                  onClick={() => setSelectedId(appraisal.id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition hover:border-primary/50 hover:bg-primary/5",
                    selectedId === appraisal.id ? "border-primary/50 bg-primary/10" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{appraisal.subject_display_name ?? appraisal.subject_email ?? "Employee"}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{appraisal.review_type} · {formatRoleLabel(appraisal.scorecard_role)}</p>
                    </div>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase", appraisal.status === "finalized" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-amber-500/30 bg-amber-500/10 text-amber-700")}>{appraisal.status}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{formatDate(appraisal.review_period_start)} → {formatDate(appraisal.review_period_end)}</span>
                    {appraisal.performance_band ? <span className={cn("rounded-full border px-2 py-0.5", bandTone(appraisal.performance_band))}>{appraisal.performance_band}</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {!selectedAppraisal && !loading ? (
            <EmptyState title="No appraisal selected" body="When RLS returns no appraisal rows, this area intentionally stays quiet instead of showing an error." />
          ) : null}

          {selectedAppraisal ? (
            <>
              <Card className="overflow-hidden">
                <div className="border-b border-border/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white dark:from-black dark:to-slate-950">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-qep-orange">{selectedAppraisal.review_type}</p>
                      <h2 className="mt-1 text-2xl font-black">{selectedAppraisal.subject_display_name ?? "Employee appraisal"}</h2>
                      <p className="mt-1 text-sm text-white/70">{formatRoleLabel(selectedAppraisal.scorecard_role)} · {formatDate(selectedAppraisal.review_period_start)} → {formatDate(selectedAppraisal.review_period_end)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
                      <MetricCard label="Overall" value={selectedAppraisal.overall_score?.toFixed(2) ?? rollup.overallScore?.toFixed(2) ?? "—"} />
                      <MetricCard label="Band" value={selectedAppraisal.performance_band ?? rollup.band ?? "Draft"} />
                      <MetricCard label="Perf raise" value={formatPercent(selectedAppraisal.performance_raise_pct ?? rollup.performanceRaisePct)} />
                      <MetricCard label="Recommended" value={formatPercent(selectedAppraisal.recommended_raise_pct ?? rollup.recommendedRaisePct)} />
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-3">
                  <StatusTile label="Reviewer" value={selectedAppraisal.reviewer_name ?? selectedAppraisal.reviewer_email ?? "—"} />
                  <StatusTile label="Manager signature" value={selectedAppraisal.manager_signed_at ? `${selectedAppraisal.manager_signature_name ?? "Signed"} · ${new Date(selectedAppraisal.manager_signed_at).toLocaleDateString()}` : "Pending"} />
                  <StatusTile label="Employee acknowledgement" value={selectedAppraisal.employee_acknowledged_at ? `${selectedAppraisal.employee_signature_name ?? "Acknowledged"} · ${new Date(selectedAppraisal.employee_acknowledged_at).toLocaleDateString()}` : "Pending"} />
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Seven equal-weight categories</h3>
                    <p className="text-xs text-muted-foreground">Live banding mirrors the backend: Sub-Par &lt;4, Normal 4–&lt;8, Excellent ≥8.</p>
                  </div>
                  <div className={cn("rounded-full border px-3 py-1 text-xs font-bold", bandTone(rollup.band))}>
                    Live rollup: {rollup.overallScore?.toFixed(2) ?? "complete all 7"} {rollup.band ? `· ${rollup.band}` : ""}
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  {selectedCategories.map((category) => {
                    const currentScore = normalizeScoreValue(scoreDraft[category.category_key]?.score ?? "");
                    const liveBand = scoreToBand(currentScore);
                    const readonly = selectedAppraisal.status === "finalized" || !canManage;
                    return (
                      <div key={category.category_key} className="rounded-2xl border border-border/70 bg-muted/10 p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-black text-primary">{category.display_order}</span>
                              <h4 className="text-sm font-bold text-foreground">{category.category_name}</h4>
                              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", bandTone(liveBand ?? category.band))}>{liveBand ?? category.band ?? "Unscored"}</span>
                            </div>
                            <ul className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                              {category.criteria.slice(0, 6).map((criterion) => <li key={criterion}>• {criterion}</li>)}
                            </ul>
                          </div>
                          <div className="w-full lg:w-56">
                            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Score 1-10</label>
                            <input
                              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-bold"
                              type="number"
                              min="1"
                              max="10"
                              step="1"
                              disabled={readonly}
                              value={scoreDraft[category.category_key]?.score ?? ""}
                              onChange={(event) => setScoreDraft((current) => ({ ...current, [category.category_key]: { score: event.target.value, notes: current[category.category_key]?.notes ?? "" } }))}
                            />
                            <textarea
                              className="mt-2 min-h-16 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                              placeholder="Evidence / coaching notes"
                              disabled={readonly}
                              value={scoreDraft[category.category_key]?.notes ?? ""}
                              onChange={(event) => setScoreDraft((current) => ({ ...current, [category.category_key]: { score: current[category.category_key]?.score ?? "", notes: event.target.value } }))}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="p-4">
                <h3 className="text-sm font-bold text-foreground">Summary, raise, and signatures</h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Manager summary
                      <textarea className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" disabled={selectedAppraisal.status === "finalized" || !canManage} value={managerSummary} onChange={(event) => setManagerSummary(event.target.value)} />
                    </label>
                    <div className="grid gap-3 md:grid-cols-3">
                      <TextList label="Key strengths" value={strengths} onChange={setStrengths} disabled={selectedAppraisal.status === "finalized" || !canManage} />
                      <TextList label="Improvement areas" value={improvements} onChange={setImprovements} disabled={selectedAppraisal.status === "finalized" || !canManage} />
                      <TextList label="Goals next period" value={goals} onChange={setGoals} disabled={selectedAppraisal.status === "finalized" || !canManage} />
                    </div>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3">
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Cost of living %
                      <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" type="number" min="0" step="0.25" disabled={selectedAppraisal.status === "finalized" || !canManage} value={colRaise} onChange={(event) => setColRaise(event.target.value)} />
                    </label>
                    <div className="rounded-xl bg-background p-3 text-xs text-muted-foreground">
                      <Sparkles className="mb-2 h-4 w-4 text-qep-orange" />
                      Backend formula: Cost of Living + Performance. Performance equals the 7-category average.
                    </div>
                    {canManage && selectedAppraisal.status === "draft" ? (
                      <>
                        <label className="block text-xs font-semibold text-muted-foreground">
                          Manager signature
                          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={managerSignature} onChange={(event) => setManagerSignature(event.target.value)} placeholder="Typed signature" />
                        </label>
                        <div className="grid gap-2">
                          <Button type="button" variant="outline" disabled={anyMutationPending} onClick={handleSave}>Save scorecard</Button>
                          <Button type="button" disabled={anyMutationPending} onClick={handleFinalize}>
                            {finalizeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
                            Finalize + sign
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </Card>

              {canAcknowledge ? (
                <Card className="border-qep-orange/30 bg-qep-orange/5 p-4">
                  <h3 className="text-sm font-bold text-foreground">Employee acknowledgement</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Acknowledgement confirms receipt and discussion, not agreement.</p>
                  <form className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end" onSubmit={handleAcknowledge}>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Signature
                      <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={employeeSignature} onChange={(event) => setEmployeeSignature(event.target.value)} required />
                    </label>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Comments
                      <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={employeeComments} onChange={(event) => setEmployeeComments(event.target.value)} placeholder="Optional comments" />
                    </label>
                    <Button type="submit" disabled={anyMutationPending}>Acknowledge</Button>
                  </form>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function TextList({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground">
      {label}
      <textarea
        className="mt-1 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="One item per line"
      />
    </label>
  );
}
