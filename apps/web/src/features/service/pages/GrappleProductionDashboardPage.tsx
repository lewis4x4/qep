import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Clock3,
  ClipboardCheck,
  Factory,
  GitBranch,
  Package,
  RefreshCcw,
  ShieldCheck,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  fetchGrappleProductionDashboard,
  formatGrappleLabel,
  grappleProductionDashboardIsEmpty,
  GRAPPLE_PRODUCTION_STAGES,
  type GrappleAccessoryInstall,
  type GrappleDashboardTimelineEvent,
  type GrappleFinalQcChecklist,
  type GrappleGtbInspection,
  type GrapplePartsSheet,
  type GrapplePipelineBuild,
  type GrappleProductionDashboardData,
  type GrappleProgressSheet,
  type GrappleStageSummaryRow,
} from "../lib/grapple-production-api";

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
  const dashboardQuery = useQuery({
    queryKey: ["grapple-production-dashboard", "stream-i"],
    queryFn: fetchGrappleProductionDashboard,
    staleTime: 60_000,
  });

  const data = dashboardQuery.data;
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.pipeline.length) {
      setSelectedBuildId(null);
      return;
    }
    if (!selectedBuildId || !data.pipeline.some((build) => build.id === selectedBuildId)) {
      setSelectedBuildId(data.pipeline[0].id);
    }
  }, [data?.pipeline, selectedBuildId]);

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
        <EmptyState />
      ) : data ? (
        <>
          <ExecutiveStrip data={data} />
          <StagePipelinePanel rows={data.stageSummary} builds={data.pipeline} />
          <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
            <BuildListPanel
              builds={data.pipeline}
              progressSheets={data.progressSheets}
              selectedBuildId={selectedBuild?.id ?? null}
              onSelectBuild={setSelectedBuildId}
            />
            <BuildDetailPanel data={data} build={selectedBuild} />
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

function EmptyState() {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-qep-orange/10 text-qep-orange">
        <Factory className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">No grapple production builds yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        Stream I is live, but this workspace has not created a standalone grapple build. Once a build exists, this dashboard will show stage pressure, child work, final QC, and timeline movement.
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

function BuildDetailPanel({ data, build }: { data: GrappleProductionDashboardData; build: GrapplePipelineBuild | null }) {
  const progress = data.progressSheets.find((sheet) => sheet.buildId === build?.id) ?? null;
  const timeline = data.timelines.find((item) => item.buildId === build?.id) ?? null;
  const inspections = data.gtbInspections.filter((item) => item.buildId === build?.id);
  const accessories = data.accessoryInstalls.filter((item) => item.buildId === build?.id);
  const partsSheets = data.partsSheets.filter((item) => item.buildId === build?.id);
  const finalQc = data.finalQcChecklists.filter((item) => item.buildId === build?.id);
  const events = data.dashboardTimeline.filter((event) => event.buildId === build?.id).slice(0, 4);

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

        <div className="grid gap-4 xl:grid-cols-2">
          <GtbInspectionPanel rows={inspections} />
          <AccessoryPanel rows={accessories} />
          <PartsSheetPanel rows={partsSheets} />
          <FinalQcPanel rows={finalQc} progress={progress} />
        </div>

        <TimelineDurationsPanel timeline={timeline} />
        <RecentBuildEvents events={events} />
      </div>
    </Card>
  );
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

function FinalQcPanel({ rows, progress }: { rows: GrappleFinalQcChecklist[]; progress: GrappleProgressSheet | null }) {
  const latest = rows[0];
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
