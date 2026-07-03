import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  Factory,
  GitBranch,
  Loader2,
  Lock,
  Package,
  PenLine,
  PlusCircle,
  RefreshCcw,
  ShieldCheck,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  completeGrappleAccessoryInstall,
  completeGrappleGtbInspection,
  completeGrappleFinalQcChecklist,
  createGrappleBuild,
  createGrappleFinalQcChecklist,
  createGrappleGtbInspection,
  ensureGrappleAccessoryInstallSteps,
  fetchGrappleProductionDashboard,
  formatGrappleLabel,
  grappleProductionDashboardIsEmpty,
  GRAPPLE_PRODUCTION_STAGES,
  signGrappleBuildFinalQc,
  transitionGrappleBuildStage,
  updateGrappleFinalQcItem,
  type GrappleAccessoryInstall,
  type GrappleDashboardTimelineEvent,
  type GrappleFinalQcChecklist,
  type GrappleFinalQcDefectSeverity,
  type GrappleFinalQcItem,
  type GrappleFinalQcItemResult,
  type GrappleGtbInspection,
  type GrapplePartsSheet,
  type GrapplePipelineBuild,
  type GrappleProductionDashboardData,
  type GrappleProgressSheet,
  type GrappleProductionStage,
  type GrappleStageSummaryRow,
} from "../lib/grapple-production-api";

const GRAPPLE_DASHBOARD_QUERY_KEY = ["grapple-production-dashboard", "stream-i"] as const;
const ELEVATED_GRAPPLE_ROLES = new Set(["admin", "manager", "owner"]);

function isElevatedGrappleRole(role: string | null | undefined): boolean {
  return ELEVATED_GRAPPLE_ROLES.has(role ?? "");
}

function trimToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nextProductionStage(currentStage: string | null | undefined): GrappleProductionStage | null {
  const currentIndex = GRAPPLE_PRODUCTION_STAGES.findIndex((stage) => stage === currentStage);
  if (currentIndex < 0 || currentIndex >= GRAPPLE_PRODUCTION_STAGES.length - 1) return null;
  return GRAPPLE_PRODUCTION_STAGES[currentIndex + 1];
}

function canMutateGrappleBuild(build: GrapplePipelineBuild | null, userId: string | null, role: string | null): boolean {
  if (isElevatedGrappleRole(role)) return true;
  return Boolean(build && userId && build.assignedLeadId === userId);
}

function canSignFinalQc(build: GrapplePipelineBuild | null, userId: string | null): boolean {
  return Boolean(build?.assignedLeadId && userId && build.assignedLeadId === userId);
}

function mutationErrorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? "Operation failed. Please retry." : null;
}

function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatMoney(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatHours(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function progressWidth(value: number | null | undefined, minimumVisible = 0): string {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  if (clamped === 0) return minimumVisible > 0 ? `${minimumVisible}%` : "0%";
  return `${Math.max(minimumVisible, clamped)}%`;
}

function statusTone(value: string | null | undefined): string {
  switch (value) {
    case "overdue":
    case "production_hold":
    case "on_hold":
    case "fail":
    case "blocked":
    case "final_qc_incomplete":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case "due_soon":
    case "awaiting_final_qc":
    case "needs_rework":
    case "in_progress":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "ready_for_release":
    case "final_qc_release_ready":
    case "production_complete":
    case "completed":
    case "complete":
    case "signed":
    case "pass":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

export function GrappleProductionDashboardPage() {
  const { profile } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: GRAPPLE_DASHBOARD_QUERY_KEY,
    queryFn: fetchGrappleProductionDashboard,
    staleTime: 60_000,
  });

  const data = dashboardQuery.data;
  const currentUserId = profile?.id ?? null;
  const currentUserName = profile?.full_name ?? profile?.email ?? "";
  const currentRole = profile?.role ?? null;
  const canCreateBuild = isElevatedGrappleRole(currentRole);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [pendingCreatedBuildId, setPendingCreatedBuildId] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.pipeline.length) {
      if (!pendingCreatedBuildId) setSelectedBuildId(null);
      return;
    }
    if (pendingCreatedBuildId) {
      if (data.pipeline.some((build) => build.id === pendingCreatedBuildId)) {
        setSelectedBuildId(pendingCreatedBuildId);
        setPendingCreatedBuildId(null);
      }
      return;
    }
    if (!selectedBuildId || !data.pipeline.some((build) => build.id === selectedBuildId)) {
      setSelectedBuildId(data.pipeline[0].id);
    }
  }, [data?.pipeline, pendingCreatedBuildId, selectedBuildId]);

  const handleBuildCreated = (buildId: string) => {
    setPendingCreatedBuildId(buildId);
    setSelectedBuildId(buildId);
  };

  const selectedBuild = useMemo(() => {
    if (!data?.pipeline.length) return null;
    return data.pipeline.find((build) => build.id === selectedBuildId) ?? data.pipeline[0];
  }, [data?.pipeline, selectedBuildId]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-24 pt-4 sm:px-6 lg:px-8">
      <ServiceSubNav />

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-qep-orange" aria-hidden />
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-qep-orange">Stream I Grapple Production</p>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            Grapple-truck production dashboard
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            A production-first surface for builds, stage pressure, GTB inspection, accessory installs,
            build parts, final QC lead sign-off, and the live build timeline backed by the shipped Stream I views.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-600 dark:text-emerald-300">
            Security-invoker views
          </span>
          <span className="rounded-full border border-border px-3 py-1">
            {data?.pipeline[0]?.updatedAt ? `Updated ${formatDateTime(data.pipeline[0].updatedAt)}` : "Live pipeline"}
          </span>
        </div>
      </header>

      {dashboardQuery.isLoading ? (
        <LoadingState />
      ) : dashboardQuery.isError ? (
        <ErrorState onRetry={() => void dashboardQuery.refetch()} />
      ) : data && grappleProductionDashboardIsEmpty(data) ? (
        <>
          <EmptyState canCreateBuild={canCreateBuild} />
          {canCreateBuild && <CreateBuildPanel onCreated={handleBuildCreated} />}
        </>
      ) : data ? (
        <>
          <ExecutiveStrip data={data} />
          {canCreateBuild && <CreateBuildPanel onCreated={handleBuildCreated} />}
          <StagePipelinePanel rows={data.stageSummary} builds={data.pipeline} />
          <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
            <BuildListPanel
              builds={data.pipeline}
              progressSheets={data.progressSheets}
              selectedBuildId={selectedBuild?.id ?? null}
              onSelectBuild={setSelectedBuildId}
            />
            <BuildDetailPanel
              data={data}
              build={selectedBuild}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentRole={currentRole}
            />
          </div>
          <TimelinePanel events={data.dashboardTimeline} selectedBuildId={selectedBuild?.id ?? null} />
        </>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <div className="h-40 animate-pulse rounded-3xl border bg-muted/20" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border bg-muted/20" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <div className="h-96 animate-pulse rounded-2xl border bg-muted/20" />
        <div className="h-96 animate-pulse rounded-2xl border bg-muted/20" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-red-500/30 bg-red-500/5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" aria-hidden />
          <div>
            <h2 className="font-semibold text-foreground">Could not load grapple production</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The Stream I views are workspace and role scoped. Retry after confirming migrations 643–645 are present in the environment.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
        >
          <RefreshCcw className="h-4 w-4" aria-hidden />
          Retry
        </button>
      </div>
    </Card>
  );
}

function EmptyState({ canCreateBuild }: { canCreateBuild: boolean }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-qep-orange/10 text-qep-orange">
        <Factory className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">No grapple production builds yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        Stream I is live, but this workspace has not created a standalone grapple build. {canCreateBuild ? "Start the first build below and the dashboard will immediately light up with stage pressure, QC gates, and timeline movement." : "Once a manager or assigned build Lead creates a build, this read-only surface will show stage pressure, final QC, and timeline movement."}
      </p>
      <Link
        to="/service"
        className="mt-5 inline-flex rounded-full bg-qep-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-qep-orange/90"
      >
        Open service command center
      </Link>
    </Card>
  );
}

function CreateBuildPanel({ onCreated }: { onCreated: (buildId: string) => void }) {
  const queryClient = useQueryClient();
  const [buildNumber, setBuildNumber] = useState("");
  const [priority, setPriority] = useState("normal");
  const [targetStartDate, setTargetStartDate] = useState("");
  const [targetCompletionDate, setTargetCompletionDate] = useState("");
  const [assignedLeadId, setAssignedLeadId] = useState("");
  const [assignedBuilderId, setAssignedBuilderId] = useState("");
  const [customerCompanyId, setCustomerCompanyId] = useState("");
  const [salesDealId, setSalesDealId] = useState("");
  const [chassisEquipmentId, setChassisEquipmentId] = useState("");

  const createMutation = useMutation({
    mutationFn: createGrappleBuild,
    onSuccess: (buildId) => {
      setBuildNumber("");
      setTargetStartDate("");
      setTargetCompletionDate("");
      setAssignedLeadId("");
      setAssignedBuilderId("");
      setCustomerCompanyId("");
      setSalesDealId("");
      setChassisEquipmentId("");
      onCreated(buildId);
      void queryClient.invalidateQueries({ queryKey: GRAPPLE_DASHBOARD_QUERY_KEY });
    },
  });

  const createError = mutationErrorMessage(createMutation.error);

  return (
    <Card className="overflow-hidden border-qep-orange/25 bg-gradient-to-br from-qep-orange/10 via-background to-background p-0">
      <div className="border-b border-border/70 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-qep-orange">Mutation controls</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Create a grapple build</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Managers and elevated production roles can open a standalone grapple build without touching service work-order gates.
            </p>
          </div>
          <Pill tone="green">Manager only create</Pill>
        </div>
      </div>
      <form
        className="grid gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!buildNumber.trim() || createMutation.isPending) return;
          createMutation.mutate({
            buildNumber: buildNumber.trim(),
            priority,
            targetStartDate: targetStartDate || null,
            targetCompletionDate: targetCompletionDate || null,
            assignedLeadId: trimToNull(assignedLeadId),
            assignedBuilderId: trimToNull(assignedBuilderId),
            customerCompanyId: trimToNull(customerCompanyId),
            salesDealId: trimToNull(salesDealId),
            chassisEquipmentId: trimToNull(chassisEquipmentId),
            metadata: { source: "grapple_production_dashboard" },
          });
        }}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <LabeledInput label="Build number" value={buildNumber} onChange={setBuildNumber} required placeholder="GTB-2026-001" />
          <LabeledSelect label="Priority" value={priority} onChange={setPriority} options={["low", "normal", "high", "expedite"]} />
          <LabeledInput label="Target start" value={targetStartDate} onChange={setTargetStartDate} type="date" />
          <LabeledInput label="Target completion" value={targetCompletionDate} onChange={setTargetCompletionDate} type="date" />
        </div>
        <details className="rounded-2xl border bg-background/70 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Optional IDs for assignment and source links</summary>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <LabeledInput label="Assigned Lead ID" value={assignedLeadId} onChange={setAssignedLeadId} placeholder="uuid" />
            <LabeledInput label="Assigned Builder ID" value={assignedBuilderId} onChange={setAssignedBuilderId} placeholder="uuid" />
            <LabeledInput label="Customer company ID" value={customerCompanyId} onChange={setCustomerCompanyId} placeholder="uuid" />
            <LabeledInput label="Sales deal ID" value={salesDealId} onChange={setSalesDealId} placeholder="uuid" />
            <LabeledInput label="Chassis equipment ID" value={chassisEquipmentId} onChange={setChassisEquipmentId} placeholder="uuid" />
          </div>
        </details>
        {createError && <InlineAlert tone="red">{createError}</InlineAlert>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Creation uses the shipped create_grapple_build RPC and preserves service work-order boundaries.</p>
          <Button type="submit" disabled={!buildNumber.trim() || createMutation.isPending} className="w-full sm:w-auto">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlusCircle className="h-4 w-4" aria-hidden />}
            Create build
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ExecutiveStrip({ data }: { data: GrappleProductionDashboardData }) {
  const activeBuilds = data.pipeline.filter((build) => build.status !== "completed").length;
  const overdue = data.progressSheets.filter((sheet) => sheet.timelineHealth === "overdue").length;
  const readyForRelease = data.progressSheets.filter((sheet) => sheet.finalQcReleaseReady).length;
  const onHold = data.pipeline.filter((build) => build.productionStage === "production_hold" || build.status === "on_hold").length;

  const cards = [
    {
      label: "Active builds",
      value: formatCount(activeBuilds),
      detail: `${formatCount(data.pipeline.length)} total in the live pipeline`,
      icon: Truck,
      tone: "text-qep-orange bg-qep-orange/10",
    },
    {
      label: "Release ready",
      value: formatCount(readyForRelease),
      detail: "Final QC pass + assigned Lead sign-off present",
      icon: ShieldCheck,
      tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-300",
    },
    {
      label: "Overdue",
      value: formatCount(overdue),
      detail: "Past target completion date",
      icon: AlertTriangle,
      tone: overdue > 0 ? "text-red-600 bg-red-500/10 dark:text-red-300" : "text-muted-foreground bg-muted/60",
    },
    {
      label: "On hold",
      value: formatCount(onHold),
      detail: "Production hold stage or hold status",
      icon: Clock3,
      tone: onHold > 0 ? "text-amber-600 bg-amber-500/10 dark:text-amber-300" : "text-muted-foreground bg-muted/60",
    },
  ];

  return (
    <section aria-label="Grapple production executive summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</p>
                <p className="mt-2 font-mono text-2xl font-bold text-foreground">{card.value}</p>
              </div>
              <div className={cn("rounded-xl p-2", card.tone)}>
                <Icon className="h-4 w-4" aria-hidden />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{card.detail}</p>
          </Card>
        );
      })}
    </section>
  );
}

function StagePipelinePanel({ rows, builds }: { rows: GrappleStageSummaryRow[]; builds: GrapplePipelineBuild[] }) {
  const maxBuilds = Math.max(...rows.map((row) => row.buildCount), 1);
  const totalsByStage = new Map<string, GrappleStageSummaryRow[]>();
  rows.forEach((row) => {
    totalsByStage.set(row.productionStage, [...(totalsByStage.get(row.productionStage) ?? []), row]);
  });

  return (
    <Card className="overflow-hidden border-qep-orange/30 bg-gradient-to-br from-qep-orange/10 via-background to-background p-0">
      <div className="border-b border-border/70 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-qep-orange">Pipeline</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Builds by production stage</h2>
          </div>
          <p className="text-sm text-muted-foreground">{formatCount(builds.length)} active Stream I build rows</p>
        </div>
      </div>
      <div className="grid gap-3 p-5 lg:grid-cols-4">
        {GRAPPLE_PRODUCTION_STAGES.map((stage) => {
          const stageRows = totalsByStage.get(stage) ?? [];
          const buildCount = stageRows.reduce((sum, row) => sum + row.buildCount, 0);
          const overdue = stageRows.reduce((sum, row) => sum + row.overdueCount, 0);
          const dueSoon = stageRows.reduce((sum, row) => sum + row.dueSoonCount, 0);
          const unassigned = stageRows.reduce((sum, row) => sum + row.unassignedLeadCount + row.unassignedBuilderCount, 0);
          return (
            <div key={stage} className="rounded-2xl border bg-background/75 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">{formatGrappleLabel(stage)}</p>
                <span className="font-mono text-lg font-bold text-foreground">{formatCount(buildCount)}</span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", overdue > 0 ? "bg-red-500" : dueSoon > 0 ? "bg-amber-500" : "bg-qep-orange")}
                  style={{ width: `${Math.max(buildCount > 0 ? 10 : 0, (buildCount / maxBuilds) * 100)}%` }}
                  aria-hidden
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
                {overdue > 0 && <Pill tone="red">{formatCount(overdue)} overdue</Pill>}
                {dueSoon > 0 && <Pill tone="amber">{formatCount(dueSoon)} due soon</Pill>}
                {unassigned > 0 && <Pill tone="muted">{formatCount(unassigned)} unassigned</Pill>}
                {buildCount === 0 && <Pill tone="muted">clear</Pill>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BuildListPanel({
  builds,
  progressSheets,
  selectedBuildId,
  onSelectBuild,
}: {
  builds: GrapplePipelineBuild[];
  progressSheets: GrappleProgressSheet[];
  selectedBuildId: string | null;
  onSelectBuild: (buildId: string) => void;
}) {
  const progressByBuild = useMemo(() => new Map(progressSheets.map((sheet) => [sheet.buildId, sheet])), [progressSheets]);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Build list</h2>
          <p className="text-xs text-muted-foreground">Select a build to inspect child work and release readiness.</p>
        </div>
        <Factory className="h-4 w-4 text-qep-orange" aria-hidden />
      </div>

      {builds.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No builds are visible for your role.</p>
      ) : (
        <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
          {builds.map((build) => {
            const progress = progressByBuild.get(build.id);
            const active = build.id === selectedBuildId;
            return (
              <button
                key={build.id}
                type="button"
                onClick={() => onSelectBuild(build.id)}
                className={cn(
                  "w-full rounded-2xl border p-4 text-left transition",
                  active ? "border-qep-orange/60 bg-qep-orange/10 shadow-sm" : "bg-background hover:border-qep-orange/40 hover:bg-qep-orange/5",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{build.buildNumber}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {build.customerCompanyName ?? "No customer linked"} · {build.chassisEquipmentName ?? build.chassisAssetTag ?? "No chassis"}
                    </p>
                  </div>
                  <StatusPill value={progress?.timelineHealth ?? build.timelineHealth} />
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-qep-orange"
                    style={{ width: progressWidth(progress?.progressPercent, 4) }}
                    aria-hidden
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatGrappleLabel(build.productionStage)}</span>
                  <span>·</span>
                  <span>{build.assignedLeadName ?? "Lead unassigned"}</span>
                  <span>·</span>
                  <span>Due {formatDate(build.targetCompletionDate)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function BuildDetailPanel({
  data,
  build,
  currentUserId,
  currentUserName,
  currentRole,
}: {
  data: GrappleProductionDashboardData;
  build: GrapplePipelineBuild | null;
  currentUserId: string | null;
  currentUserName: string;
  currentRole: string | null;
}) {
  const progress = data.progressSheets.find((sheet) => sheet.buildId === build?.id) ?? null;
  const timeline = data.timelines.find((item) => item.buildId === build?.id) ?? null;
  const inspections = data.gtbInspections.filter((item) => item.buildId === build?.id);
  const accessories = data.accessoryInstalls.filter((item) => item.buildId === build?.id);
  const partsSheets = data.partsSheets.filter((item) => item.buildId === build?.id);
  const finalQc = data.finalQcChecklists.filter((item) => item.buildId === build?.id);
  const finalQcItems = data.finalQcItems.filter((item) => item.buildId === build?.id);
  const events = data.dashboardTimeline.filter((event) => event.buildId === build?.id).slice(0, 4);
  const canMutate = canMutateGrappleBuild(build, currentUserId, currentRole);

  if (!build) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Select a build to open the production detail.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border/70 bg-gradient-to-br from-qep-orange/10 via-background to-background p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-qep-orange">Selected build</p>
            <h2 className="mt-1 text-2xl font-bold text-foreground">{build.buildNumber}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {build.customerCompanyName ?? "No customer"} · {build.salesDealName ?? "No sales deal linked"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill value={build.productionStage} />
            <StatusPill value={progress?.timelineHealth ?? build.timelineHealth} />
            {progress?.finalQcReleaseReady && <Pill tone="green">Release ready</Pill>}
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="font-mono font-semibold text-foreground">{formatCount(progress?.progressPercent ?? 0)}%</span>
          </div>
          <div className="h-3 rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", progress?.finalQcReleaseReady ? "bg-emerald-500" : "bg-qep-orange")}
              style={{ width: progressWidth(progress?.progressPercent) }}
              aria-hidden
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricMini icon={UserRound} label="Lead" value={build.assignedLeadName ?? "Unassigned"} />
          <MetricMini icon={Wrench} label="Builder" value={build.assignedBuilderName ?? "Unassigned"} />
          <MetricMini icon={Truck} label="Chassis" value={build.chassisEquipmentName ?? build.chassisAssetTag ?? "Unlinked"} />
          <MetricMini icon={Clock3} label="Due" value={formatDate(build.targetCompletionDate)} />
        </div>

        {build.holdReason || build.productionNotes ? (
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            {build.holdReason && <p><span className="font-semibold text-foreground">Hold:</span> {build.holdReason}</p>}
            {build.productionNotes && <p className="mt-1"><span className="font-semibold text-foreground">Notes:</span> {build.productionNotes}</p>}
          </div>
        ) : null}

        <ReleaseGatePanel build={build} progress={progress} latestFinalQc={finalQc[0] ?? null} />
        {canMutate ? (
          <GrappleBuildMutationPanel
            build={build}
            progress={progress}
            gtbInspectionRows={inspections}
            accessoryRows={accessories}
            finalQcRows={finalQc}
            finalQcItems={finalQcItems}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
          />
        ) : (
          <ReadOnlyMutationNotice />
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <GtbInspectionPanel rows={inspections} />
          <AccessoryPanel rows={accessories} />
          <PartsSheetPanel rows={partsSheets} />
          <FinalQcPanel rows={finalQc} items={finalQcItems} progress={progress} />
        </div>

        <TimelineDurationsPanel timeline={timeline} />
        <RecentBuildEvents events={events} />
      </div>
    </Card>
  );
}

function ReleaseGatePanel({
  build,
  progress,
  latestFinalQc,
}: {
  build: GrapplePipelineBuild;
  progress: GrappleProgressSheet | null;
  latestFinalQc: GrappleFinalQcChecklist | null;
}) {
  const ready = Boolean(progress?.finalQcReleaseReady);
  const completeWithoutEvidence = build.productionStage === "production_complete" && !ready;
  const blocked = !ready && (build.productionStage === "ready_for_final_qc" || build.productionStage === "production_complete");

  return (
    <div className={cn(
      "rounded-2xl border p-4",
      ready
        ? "border-emerald-500/30 bg-emerald-500/10"
        : blocked
          ? "border-amber-500/30 bg-amber-500/10"
          : "bg-background/70",
    )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={cn("rounded-xl p-2", ready ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-qep-orange/10 text-qep-orange")}>
            {ready ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Final-QC release gate</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {ready
                ? "Final QC is pass/signed and the build can be released to production complete."
                : completeWithoutEvidence
                  ? "Production is marked complete, but final-QC release evidence is incomplete. Review the checklist and Lead sign-off before relying on this release state."
                  : progress?.finalQcReleaseReason ?? "Production complete remains blocked until final QC passes and the assigned Lead signs off."}
            </p>
          </div>
        </div>
        <StatusPill value={progress?.finalQcReleaseCode ?? (ready ? "final_qc_release_ready" : "final_qc_incomplete")} />
      </div>
      {!ready && progress?.finalQcReleaseMissing.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {progress.finalQcReleaseMissing.slice(0, 5).map((item, index) => (
            <Pill key={index} tone="amber">{describeReleaseMissing(item)}</Pill>
          ))}
        </div>
      ) : null}
      {latestFinalQc && (
        <p className="mt-3 text-xs text-muted-foreground">
          Latest checklist #{latestFinalQc.checklistNumber}: {formatGrappleLabel(latestFinalQc.status)} · {formatCount(latestFinalQc.passedItemCount)}/{formatCount(latestFinalQc.itemCount)} pass · Lead {latestFinalQc.leadSignedByName ?? latestFinalQc.leadSignatureName ?? "not signed"}
        </p>
      )}
    </div>
  );
}

function GrappleBuildMutationPanel({
  build,
  progress,
  gtbInspectionRows,
  accessoryRows,
  finalQcRows,
  finalQcItems,
  currentUserId,
  currentUserName,
}: {
  build: GrapplePipelineBuild;
  progress: GrappleProgressSheet | null;
  gtbInspectionRows: GrappleGtbInspection[];
  accessoryRows: GrappleAccessoryInstall[];
  finalQcRows: GrappleFinalQcChecklist[];
  finalQcItems: GrappleFinalQcItem[];
  currentUserId: string | null;
  currentUserName: string;
}) {
  const queryClient = useQueryClient();
  const [nextStage, setNextStage] = useState<GrappleProductionStage | "">(() => nextProductionStage(build.productionStage) ?? "");
  const [transitionNote, setTransitionNote] = useState("");
  const [gtbNotes, setGtbNotes] = useState("");
  const [accessoryNotes, setAccessoryNotes] = useState("");
  const [qcNotes, setQcNotes] = useState("");
  const [signatureName, setSignatureName] = useState(currentUserName);
  const latestGtbInspection = gtbInspectionRows[0] ?? null;
  const latestFinalQc = finalQcRows[0] ?? null;
  const latestItems = latestFinalQc
    ? finalQcItems.filter((item) => item.checklistId === latestFinalQc.id).sort((a, b) => a.displayOrder - b.displayOrder)
    : [];

  useEffect(() => {
    setNextStage(nextProductionStage(build.productionStage) ?? "");
    setTransitionNote("");
    setGtbNotes("");
    setAccessoryNotes("");
    setQcNotes("");
  }, [build.id, build.productionStage]);

  useEffect(() => {
    if (!signatureName && currentUserName) setSignatureName(currentUserName);
  }, [currentUserName, signatureName]);

  const invalidateDashboard = () => void queryClient.invalidateQueries({ queryKey: GRAPPLE_DASHBOARD_QUERY_KEY });
  const transitionMutation = useMutation({
    mutationFn: transitionGrappleBuildStage,
    onSuccess: invalidateDashboard,
  });
  const createQcMutation = useMutation({
    mutationFn: createGrappleFinalQcChecklist,
    onSuccess: invalidateDashboard,
  });
  const createGtbMutation = useMutation({
    mutationFn: createGrappleGtbInspection,
    onSuccess: invalidateDashboard,
  });
  const completeGtbMutation = useMutation({
    mutationFn: completeGrappleGtbInspection,
    onSuccess: invalidateDashboard,
  });
  const ensureAccessoryMutation = useMutation({
    mutationFn: ensureGrappleAccessoryInstallSteps,
    onSuccess: invalidateDashboard,
  });
  const completeAccessoryMutation = useMutation({
    mutationFn: completeGrappleAccessoryInstall,
    onSuccess: invalidateDashboard,
  });
  const updateItemMutation = useMutation({
    mutationFn: updateGrappleFinalQcItem,
    onSuccess: invalidateDashboard,
  });
  const markOpenPassMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        latestItems
          .filter((item) => item.result === "not_checked")
          .map((item) => updateGrappleFinalQcItem({ itemId: item.id, result: "pass", userId: currentUserId })),
      );
    },
    onSuccess: invalidateDashboard,
  });
  const completeQcMutation = useMutation({
    mutationFn: completeGrappleFinalQcChecklist,
    onSuccess: invalidateDashboard,
  });
  const signQcMutation = useMutation({
    mutationFn: signGrappleBuildFinalQc,
    onSuccess: invalidateDashboard,
  });

  const transitionBlockedByGate = nextStage === "production_complete" && !progress?.finalQcReleaseReady;
  const hasForwardStage = Boolean(nextStage);
  const nextGtbInspectionNumber = Math.max(0, ...gtbInspectionRows.map((row) => row.inspectionNumber)) + 1;
  const latestGtbCanSign = Boolean(latestGtbInspection && latestGtbInspection.status !== "signed" && signatureName.trim());
  const incompleteAccessories = accessoryRows.filter((row) => row.status !== "completed" && row.status !== "waived");
  const nextChecklistNumber = Math.max(0, ...finalQcRows.map((row) => row.checklistNumber)) + 1;
  const releaseCleanItems = latestItems.length > 0 && latestItems.every((item) => (item.result === "pass" || item.result === "not_applicable") && !item.reworkRequired);
  const latestCanComplete = Boolean(latestFinalQc && latestFinalQc.status !== "signed" && releaseCleanItems);
  const leadCanSign = canSignFinalQc(build, currentUserId);
  const latestCanSign = Boolean(latestFinalQc && latestFinalQc.status !== "signed" && latestFinalQc.overallResult === "pass" && signatureName.trim());
  const busy = transitionMutation.isPending || createGtbMutation.isPending || completeGtbMutation.isPending || ensureAccessoryMutation.isPending || completeAccessoryMutation.isPending || createQcMutation.isPending || updateItemMutation.isPending || markOpenPassMutation.isPending || completeQcMutation.isPending || signQcMutation.isPending;
  const error = mutationErrorMessage(transitionMutation.error)
    ?? mutationErrorMessage(createGtbMutation.error)
    ?? mutationErrorMessage(completeGtbMutation.error)
    ?? mutationErrorMessage(ensureAccessoryMutation.error)
    ?? mutationErrorMessage(completeAccessoryMutation.error)
    ?? mutationErrorMessage(createQcMutation.error)
    ?? mutationErrorMessage(updateItemMutation.error)
    ?? mutationErrorMessage(markOpenPassMutation.error)
    ?? mutationErrorMessage(completeQcMutation.error)
    ?? mutationErrorMessage(signQcMutation.error);

  const updateItem = (item: GrappleFinalQcItem, result: GrappleFinalQcItemResult, severity?: GrappleFinalQcDefectSeverity | null) => {
    updateItemMutation.mutate({
      itemId: item.id,
      result,
      userId: currentUserId,
      defectSeverity: result === "fail" ? severity ?? item.defectSeverity ?? "major" : null,
      reworkRequired: result === "fail",
      notes: item.notes,
      measuredValue: item.measuredValue,
    });
  };

  return (
    <div className="rounded-2xl border border-qep-orange/25 bg-background/80 p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Build mutation console</h3>
          <p className="text-xs text-muted-foreground">Visible only to elevated operators or the assigned build Lead. Sales/service roles remain read-only.</p>
        </div>
        <Pill tone="green">Write enabled</Pill>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border bg-muted/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-qep-orange" aria-hidden />
            <h4 className="font-semibold text-foreground">Stage transition</h4>
          </div>
          <div className="grid gap-3">
            <LabeledSelect
              label="Next stage"
              value={nextStage || build.productionStage}
              onChange={(value) => setNextStage(value as GrappleProductionStage)}
              options={hasForwardStage ? [...GRAPPLE_PRODUCTION_STAGES] : [build.productionStage]}
              disabled={!hasForwardStage}
            />
            <LabeledTextarea label="Transition note" value={transitionNote} onChange={setTransitionNote} placeholder="What changed on the floor?" />
            {transitionBlockedByGate && (
              <InlineAlert tone="amber">
                Production complete is blocked: {progress?.finalQcReleaseReason ?? "final QC must pass and the assigned Lead must sign."}
              </InlineAlert>
            )}
            <Button
              type="button"
              disabled={busy || !hasForwardStage || transitionBlockedByGate || nextStage === build.productionStage}
              onClick={() => {
                if (!nextStage) return;
                transitionMutation.mutate({
                  buildId: build.id,
                  nextStage,
                  note: transitionNote.trim() || `Moved to ${formatGrappleLabel(nextStage)} from the production dashboard.`,
                  metadata: { source: "grapple_production_dashboard" },
                });
              }}
              className="w-full"
            >
              {transitionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GitBranch className="h-4 w-4" aria-hidden />}
              Move stage
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border bg-muted/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Package className="h-4 w-4 text-qep-orange" aria-hidden />
            <h4 className="font-semibold text-foreground">Accessory installs</h4>
          </div>
          <div className="grid gap-3">
            {accessoryRows.length === 0 ? (
              <>
                <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No tank/cooler/extension install steps exist for this build yet.</p>
                <Button type="button" disabled={busy} onClick={() => ensureAccessoryMutation.mutate(build.id)}>
                  {ensureAccessoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Package className="h-4 w-4" aria-hidden />}
                  Create standard install steps
                </Button>
              </>
            ) : (
              <>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {accessoryRows.map((row) => (
                    <div key={row.id} className="rounded-xl border bg-background/70 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{formatGrappleLabel(row.accessoryLabel || row.accessoryType)}</p>
                          <p className="text-xs text-muted-foreground">{row.installerName ?? "Installer unassigned"} · {formatDateTime(row.installedAt)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill value={row.status} />
                          {row.status !== "completed" && row.status !== "waived" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => completeAccessoryMutation.mutate({
                                installId: row.id,
                                userId: currentUserId,
                                notes: accessoryNotes,
                              })}
                            >
                              {completeAccessoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                              Complete
                            </Button>
                          )}
                        </div>
                      </div>
                      {row.blockedReason && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{row.blockedReason}</p>}
                    </div>
                  ))}
                </div>
                <LabeledTextarea label="Install notes" value={accessoryNotes} onChange={setAccessoryNotes} placeholder="Install completion or verification notes" />
                {incompleteAccessories.length === 0 && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                    Tank, cooler, and extension install steps are complete or waived for this build.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-muted/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-qep-orange" aria-hidden />
            <h4 className="font-semibold text-foreground">GTB inspection</h4>
          </div>
          {!latestGtbInspection ? (
            <div className="grid gap-3">
              <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No GTB inspection form exists for this build yet.</p>
              <LabeledTextarea label="Inspection notes" value={gtbNotes} onChange={setGtbNotes} placeholder="Mounting, hydraulics, controls, finish notes" />
              <Button
                type="button"
                disabled={busy}
                onClick={() => createGtbMutation.mutate({
                  buildId: build.id,
                  inspectionNumber: nextGtbInspectionNumber,
                  userId: currentUserId,
                  notes: gtbNotes,
                })}
              >
                {createGtbMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="h-4 w-4" aria-hidden />}
                Open GTB inspection
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill value={latestGtbInspection.status} />
                <StatusPill value={latestGtbInspection.overallResult ?? "inspection_open"} />
                <Pill tone={latestGtbInspection.reworkRequiredCount > 0 ? "amber" : "green"}>
                  {formatCount(latestGtbInspection.itemCount)} checks
                </Pill>
              </div>
              <p className="rounded-xl border bg-background/70 p-3 text-sm text-muted-foreground">
                Inspection #{latestGtbInspection.inspectionNumber} is attached to {latestGtbInspection.buildNumber}. Opening a new form is disabled until the current form is complete.
              </p>
              <LabeledTextarea label="Inspection notes" value={gtbNotes} onChange={setGtbNotes} placeholder="Completion notes or rework context" />
              <LabeledInput label="Signature name" value={signatureName} onChange={setSignatureName} placeholder="Inspector name" disabled={latestGtbInspection.status === "signed"} />
              <Button
                type="button"
                disabled={busy || !latestGtbCanSign}
                onClick={() => completeGtbMutation.mutate({
                  inspectionId: latestGtbInspection.id,
                  signatureName: signatureName.trim(),
                  userId: currentUserId,
                  notes: gtbNotes,
                })}
              >
                {completeGtbMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
                Pass and sign GTB
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-muted/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-qep-orange" aria-hidden />
            <h4 className="font-semibold text-foreground">Final QC checklist</h4>
          </div>
          {!latestFinalQc ? (
            <div className="grid gap-3">
              <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No final-QC checklist exists for this build yet.</p>
              <Button
                type="button"
                disabled={busy}
                onClick={() => createQcMutation.mutate({
                  buildId: build.id,
                  checklistNumber: nextChecklistNumber,
                  userId: currentUserId,
                  notes: "Final QC checklist opened from the grapple production dashboard.",
                })}
              >
                {createQcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="h-4 w-4" aria-hidden />}
                Create final-QC checklist
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill value={latestFinalQc.status} />
                <StatusPill value={latestFinalQc.overallResult ?? progress?.finalQcReleaseCode} />
                <Pill tone={releaseCleanItems ? "green" : "amber"}>{formatCount(latestFinalQc.uncheckedItemCount)} open</Pill>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {latestItems.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Checklist header exists, but no line items are visible yet.</p>
                ) : latestItems.map((item) => (
                  <div key={item.id} className="rounded-xl border bg-background/70 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{item.prompt}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatGrappleLabel(item.sectionKey)} · {item.checkedByName ?? "unchecked"}</p>
                      </div>
                      <StatusPill value={item.result} />
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_0.8fr]">
                      <LabeledSelect
                        label="Result"
                        value={item.result}
                        onChange={(value) => updateItem(item, value as GrappleFinalQcItemResult)}
                        options={["not_checked", "pass", "not_applicable", "fail"]}
                        disabled={busy || latestFinalQc.status === "signed"}
                      />
                      {item.result === "fail" && (
                        <LabeledSelect
                          label="Severity"
                          value={item.defectSeverity ?? "major"}
                          onChange={(value) => updateItem(item, "fail", value as GrappleFinalQcDefectSeverity)}
                          options={["minor", "major", "critical"]}
                          disabled={busy || latestFinalQc.status === "signed"}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" disabled={busy || latestFinalQc.status === "signed" || latestItems.every((item) => item.result !== "not_checked")} onClick={() => markOpenPassMutation.mutate()}>
                  {markOpenPassMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                  Mark open pass
                </Button>
                <Button type="button" variant="outline" disabled={busy || !latestCanComplete} onClick={() => completeQcMutation.mutate({ checklistId: latestFinalQc.id, userId: currentUserId, notes: qcNotes })}>
                  {completeQcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ClipboardCheck className="h-4 w-4" aria-hidden />}
                  Complete checklist
                </Button>
              </div>
              <LabeledTextarea label="QC completion notes" value={qcNotes} onChange={setQcNotes} placeholder="Release packet notes or constraints" />
              <div className="rounded-xl border bg-background/70 p-3">
                <div className="mb-3 flex items-center gap-2">
                  <PenLine className="h-4 w-4 text-qep-orange" aria-hidden />
                  <p className="text-sm font-semibold text-foreground">Assigned Lead sign-off</p>
                </div>
                {!leadCanSign && <InlineAlert tone="amber">Only the assigned build Lead can sign final QC. Managers can prepare the checklist, but release sign-off remains Lead-bound.</InlineAlert>}
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <LabeledInput label="Signature name" value={signatureName} onChange={setSignatureName} placeholder="Lead name" disabled={latestFinalQc.status === "signed"} />
                  <Button type="button" disabled={busy || !leadCanSign || !latestCanSign} onClick={() => signQcMutation.mutate({
                    checklistId: latestFinalQc.id,
                    signatureName: signatureName.trim(),
                    signatureStatement: "I certify that final QC passed and this grapple build is ready for release.",
                    notes: qcNotes,
                  })}>
                    {signQcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
                    Sign final QC
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {error && <InlineAlert tone="red">{error}</InlineAlert>}
    </div>
  );
}

function ReadOnlyMutationNotice() {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-semibold text-foreground">Read-only production view</p>
          <p className="mt-1">Mutation controls are hidden for sales/service readers. Assigned build Leads and manager/elevated roles can create builds, move stages, complete GTB/accessory checks, complete final QC, and sign release.</p>
        </div>
      </div>
    </div>
  );
}

function describeReleaseMissing(value: unknown): string {
  if (!value || typeof value !== "object") return "QC requirement";
  const source = value as Record<string, unknown>;
  if (typeof source.reason === "string") return source.reason;
  if (typeof source.field === "string") return formatGrappleLabel(source.field);
  if (typeof source.scope === "string") return formatGrappleLabel(source.scope);
  return "QC requirement";
}

function GtbInspectionPanel({ rows }: { rows: GrappleGtbInspection[] }) {
  const latest = rows[0];
  return (
    <DetailSection icon={ClipboardCheck} title="GTB inspection" empty={!latest} emptyLabel="No GTB inspection header yet.">
      {latest && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">Inspection #{latest.inspectionNumber}</p>
              <p className="text-xs text-muted-foreground">{latest.inspectedByName ?? "Inspector unassigned"} · {formatDateTime(latest.inspectedAt)}</p>
            </div>
            <StatusPill value={latest.overallResult ?? latest.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <MetricBox label="Items" value={formatCount(latest.itemCount)} />
            <MetricBox label="Failed" value={formatCount(latest.failedItemCount)} />
            <MetricBox label="Rework" value={formatCount(latest.reworkRequiredCount)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Signed: {latest.signedByName ?? latest.signatureName ?? "not signed"} · {formatDateTime(latest.signedAt)}
          </p>
        </>
      )}
    </DetailSection>
  );
}

function AccessoryPanel({ rows }: { rows: GrappleAccessoryInstall[] }) {
  return (
    <DetailSection icon={Package} title="Accessory installs" empty={rows.length === 0} emptyLabel="No tank/cooler/extension install rows yet.">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border bg-background/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{formatGrappleLabel(row.accessoryLabel || row.accessoryType)}</p>
                <p className="text-xs text-muted-foreground">{row.installerName ?? "Installer unassigned"}</p>
              </div>
              <StatusPill value={row.status} />
            </div>
            {row.blockedReason && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{row.blockedReason}</p>}
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

function PartsSheetPanel({ rows }: { rows: GrapplePartsSheet[] }) {
  const latest = rows[0];
  return (
    <DetailSection icon={Package} title="Build parts sheet" empty={!latest} emptyLabel="No build parts sheet yet.">
      {latest && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">{latest.title}</p>
              <p className="text-xs text-muted-foreground">Sheet #{latest.sheetNumber} · {latest.issuedByName ?? "not issued"}</p>
            </div>
            <StatusPill value={latest.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <MetricBox label="Lines" value={formatCount(latest.lineCount)} />
            <MetricBox label="Qty" value={formatCount(latest.totalQuantity)} />
            <MetricBox label="Cost" value={formatMoney(latest.totalCost)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Locked: {latest.lockedByName ?? "not locked"} · {formatDateTime(latest.lockedAt)}</p>
        </>
      )}
    </DetailSection>
  );
}

function FinalQcPanel({ rows, items, progress }: { rows: GrappleFinalQcChecklist[]; items: GrappleFinalQcItem[]; progress: GrappleProgressSheet | null }) {
  const latest = rows[0];
  const latestItems = latest ? items.filter((item) => item.checklistId === latest.id).sort((a, b) => a.displayOrder - b.displayOrder) : [];
  return (
    <DetailSection icon={ShieldCheck} title="Final QC + Lead sign-off" empty={!latest} emptyLabel="No final QC checklist yet.">
      {latest && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">Checklist #{latest.checklistNumber}</p>
              <p className="text-xs text-muted-foreground">QC: {latest.qcPerformedByName ?? "unassigned"} · {formatDateTime(latest.qcPerformedAt)}</p>
            </div>
            <StatusPill value={progress?.finalQcReleaseCode ?? latest.overallResult ?? latest.status} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
            <MetricBox label="Pass" value={formatCount(latest.passedItemCount)} />
            <MetricBox label="Fail" value={formatCount(latest.failedItemCount)} />
            <MetricBox label="Rework" value={formatCount(latest.reworkRequiredCount)} />
            <MetricBox label="Open" value={formatCount(latest.uncheckedItemCount)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Lead sign-off: {latest.leadSignedByName ?? latest.leadSignatureName ?? "not signed"} · {formatDateTime(latest.leadSignedAt)}
          </p>
          {latestItems.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {latestItems.slice(0, 4).map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border bg-muted/20 p-2 text-xs">
                  <span className="text-muted-foreground">{item.prompt}</span>
                  <StatusPill value={item.result} />
                </div>
              ))}
            </div>
          )}
          {progress?.finalQcReleaseReason && (
            <p className="mt-2 rounded-xl border bg-muted/20 p-2 text-xs text-muted-foreground">{progress.finalQcReleaseReason}</p>
          )}
        </>
      )}
    </DetailSection>
  );
}

function TimelineDurationsPanel({ timeline }: { timeline: { stageDurations: Array<{ stage: string; durationHours: number; entryCount: number }> } | null }) {
  return (
    <div className="rounded-2xl border bg-background/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Stage durations</h3>
          <p className="text-xs text-muted-foreground">Computed from `grapple_build_stage_events` via the timeline view.</p>
        </div>
        <GitBranch className="h-4 w-4 text-qep-orange" aria-hidden />
      </div>
      {!timeline?.stageDurations.length ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No stage events beyond the build header yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {timeline.stageDurations.map((duration) => (
            <div key={duration.stage} className="rounded-xl border bg-muted/20 p-3">
              <p className="text-xs font-semibold text-foreground">{formatGrappleLabel(duration.stage)}</p>
              <p className="mt-1 font-mono text-lg font-bold text-foreground">{formatHours(duration.durationHours)}</p>
              <p className="text-[10px] text-muted-foreground">{formatCount(duration.entryCount)} entries</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentBuildEvents({ events }: { events: GrappleDashboardTimelineEvent[] }) {
  return (
    <div className="rounded-2xl border bg-background/70 p-4">
      <h3 className="font-semibold text-foreground">Recent build timeline</h3>
      {events.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No build-specific timeline events yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {events.map((event) => (
            <div key={event.eventId} className="flex gap-3">
              <div className="mt-1 h-2 w-2 rounded-full bg-qep-orange" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatGrappleLabel(event.eventType)} · {event.toStage ? formatGrappleLabel(event.toStage) : "Status update"}
                </p>
                <p className="text-xs text-muted-foreground">{event.note ?? "No note"}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{formatDateTime(event.createdAt)} · {event.actorName ?? "System"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelinePanel({ events, selectedBuildId }: { events: GrappleDashboardTimelineEvent[]; selectedBuildId: string | null }) {
  const visibleEvents = selectedBuildId ? events.filter((event) => event.buildId === selectedBuildId).slice(0, 8) : events.slice(0, 8);
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">Production timeline</h2>
          <p className="text-xs text-muted-foreground">Latest dashboard events from `v_grapple_build_dashboard_timeline`.</p>
        </div>
        <Clock3 className="h-4 w-4 text-qep-orange" aria-hidden />
      </div>
      {visibleEvents.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No timeline events are visible yet.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleEvents.map((event) => (
            <div key={event.eventId} className="rounded-2xl border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{event.buildNumber}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)} · {event.actorName ?? "System"}</p>
                </div>
                <StatusPill value={event.eventType} />
              </div>
              <p className="mt-3 text-sm text-foreground">
                {event.fromStage ? `${formatGrappleLabel(event.fromStage)} → ` : ""}{event.toStage ? formatGrappleLabel(event.toStage) : formatGrappleLabel(event.toStatus)}
              </p>
              {event.note && <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DetailSection({
  icon: Icon,
  title,
  empty,
  emptyLabel,
  children,
}: {
  icon: typeof ClipboardCheck;
  title: string;
  empty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-background/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-xl bg-qep-orange/10 p-2 text-qep-orange">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <h3 className="font-semibold text-foreground">{title}</h3>
      </div>
      {empty ? <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">{emptyLabel}</p> : children}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="h-11 rounded-xl border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-qep-orange focus:ring-2 focus:ring-qep-orange/15 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-11 rounded-xl border bg-background px-3 text-sm font-medium normal-case tracking-normal text-foreground outline-none transition focus:border-qep-orange focus:ring-2 focus:ring-qep-orange/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option} value={option}>{formatGrappleLabel(option)}</option>
        ))}
      </select>
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="rounded-xl border bg-background px-3 py-2 text-sm font-medium normal-case tracking-normal text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-qep-orange focus:ring-2 focus:ring-qep-orange/15"
      />
    </label>
  );
}

function InlineAlert({ tone, children }: { tone: "red" | "amber"; children: ReactNode }) {
  return (
    <div className={cn(
      "rounded-xl border p-3 text-sm",
      tone === "red"
        ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    )}>
      {children}
    </div>
  );
}

function MetricMini({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background/70 p-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StatusPill({ value }: { value: string | null | undefined }) {
  return <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", statusTone(value))}>{formatGrappleLabel(value)}</span>;
}

function Pill({ tone, children }: { tone: "red" | "amber" | "green" | "muted"; children: ReactNode }) {
  const className = {
    red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    muted: "border-border bg-muted/40 text-muted-foreground",
  }[tone];
  return <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide", className)}>{children}</span>;
}
