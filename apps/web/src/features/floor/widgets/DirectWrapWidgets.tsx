/**
 * DirectWrapWidgets — zero-prop Floor adapters around existing feature widgets.
 *
 * These are intentionally thin. The source components stay owned by their
 * feature areas; the role-home wrappers provide data, loading/error states,
 * and a compact card frame.
 */
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ClipboardList,
  Gauge,
  Loader2,
  PackageCheck,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { AiBriefingCard } from "@/features/sales/components/AiBriefingCard";
import { DaySummaryCard } from "@/features/sales/components/DaySummaryCard";
import { useTodayFeed } from "@/features/sales/hooks/useTodayFeed";
import { fetchRepPipeline } from "@/features/sales/lib/sales-api";
import type { RepPipelineDeal } from "@/features/sales/lib/types";
import { DecisionRoomScoreboard } from "@/features/qrm/components/DecisionRoomScoreboard";
import { buildScores } from "@/features/qrm/lib/decision-room-scoring";
import { ServicePartsHubStrip } from "@/features/service/components/ServicePartsHubStrip";
import { useServiceJobList } from "@/features/service/hooks/useServiceJobs";
import type { ServiceJobWithRelations } from "@/features/service/lib/types";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function FloorWidgetShell({
  title,
  icon,
  to,
  linkLabel = "Open",
  children,
  minHeight = "min-h-[220px]",
}: {
  title: string;
  icon: ReactNode;
  to?: string;
  linkLabel?: string;
  children: ReactNode;
  minHeight?: string;
}) {
  return (
    <div
      role="figure"
      aria-label={title}
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10",
        "bg-[#121927] p-4 shadow-[0_18px_60px_-44px_rgba(0,0,0,0.95)]",
        "transition-all duration-150 ease-out hover:border-[#f28a07]/35",
        minHeight,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-slate-500">{icon}</span>
          <h3 className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {title}
          </h3>
        </div>
        {to ? (
          <Link
            to={to}
            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-[#f28a07]"
          >
            {linkLabel}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="mt-3 flex-1">{children}</div>
    </div>
  );
}

export function LoadingLine() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      Loading...
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return <p className="text-xs text-rose-300">{children}</p>;
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 text-center">
      <span className="text-emerald-400/70">{icon}</span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-[20rem] text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}

function closingSoonCount(pipeline: RepPipelineDeal[]): number {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  return pipeline.filter((deal) => {
    if (!deal.expected_close_on) return false;
    const diff = new Date(deal.expected_close_on).getTime() - now;
    return diff >= 0 && diff < week;
  }).length;
}

export function SalesAiBriefingFloorWidget() {
  const { profile } = useAuth();
  const { liveStats, livePriorityActions, pipeline, timeOfDay, isLoading, error } =
    useTodayFeed();
  const firstName = profile?.full_name?.split(" ")[0] ?? "";

  return (
    <FloorWidgetShell
      title="AI briefing"
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/sales/today"
      minHeight="min-h-[190px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {error ? <ErrorLine>Couldn't load today's briefing right now.</ErrorLine> : null}
      {!isLoading && !error ? (
        <AiBriefingCard
          firstName={firstName}
          timeOfDay={timeOfDay}
          pipelineValue={liveStats.total_pipeline_value}
          closingSoonCount={closingSoonCount(pipeline)}
          priorityCount={livePriorityActions.length}
        />
      ) : null}
    </FloorWidgetShell>
  );
}

export function SalesDaySummaryFloorWidget() {
  const { pipeline, isLoading, error } = useTodayFeed();

  return (
    <FloorWidgetShell
      title="Day summary"
      icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/sales/today"
      minHeight="min-h-[190px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {error ? <ErrorLine>Couldn't load today's sales summary.</ErrorLine> : null}
      {!isLoading && !error ? <DaySummaryCard pipeline={pipeline} /> : null}
    </FloorWidgetShell>
  );
}

function sortDealForDecisionRoom(a: RepPipelineDeal, b: RepPipelineDeal): number {
  const heatRank: Record<RepPipelineDeal["heat_status"], number> = {
    cold: 3,
    cooling: 2,
    warm: 1,
  };
  const heat = heatRank[b.heat_status] - heatRank[a.heat_status];
  if (heat !== 0) return heat;
  return (b.amount ?? 0) - (a.amount ?? 0);
}

export function DecisionRoomScoreboardFloorWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["floor", "decision-room-scoreboard"],
    queryFn: fetchRepPipeline,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const focusDeal = useMemo(
    () => [...(data ?? [])].sort(sortDealForDecisionRoom)[0] ?? null,
    [data],
  );

  const scores = useMemo(() => {
    if (!focusDeal) return null;
    const daysSinceActivity = focusDeal.days_since_activity ?? 0;
    const overdueTaskCount = daysSinceActivity >= 14 ? 1 : 0;
    const blockerPresent = focusDeal.heat_status === "cold";
    return buildScores({
      seats: [],
      expectedArchetypes: ["champion", "economic_buyer", "operations"],
      expectedCloseOn: focusDeal.expected_close_on,
      openTaskCount: focusDeal.next_follow_up_at ? 1 : 0,
      overdueTaskCount,
      pendingApprovalCount: 0,
      quotePresented: focusDeal.stage.toLowerCase().includes("quote"),
      blockerPresent,
    });
  }, [focusDeal]);

  return (
    <FloorWidgetShell
      title="Decision room"
      icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
      to={focusDeal ? `/qrm/deals/${focusDeal.deal_id}/room` : "/qrm/deals"}
      linkLabel={focusDeal ? "Room" : "Deals"}
      minHeight="min-h-[250px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {isError ? <ErrorLine>Couldn't load decision-room signals.</ErrorLine> : null}
      {!isLoading && !isError && !focusDeal ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" aria-hidden="true" />}
          title="No active room"
          body="Active deals will surface here once the pipeline has a live decision to track."
        />
      ) : null}
      {!isLoading && !isError && focusDeal && scores ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/70 px-3 py-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {focusDeal.customer_name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {focusDeal.deal_name} · {focusDeal.stage}
            </p>
          </div>
          <DecisionRoomScoreboard scores={scores} />
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}

function scorePartsJob(job: ServiceJobWithRelations): number {
  const partsCount = job.parts_count?.[0]?.count ?? job.parts?.length ?? 0;
  const stagedCount = job.parts_staged_count?.[0]?.count ?? 0;
  const priorityScore = job.priority === "critical" ? 40 : job.priority === "urgent" ? 20 : 0;
  return priorityScore + partsCount * 5 + stagedCount * 3 + (job.fulfillment_run_id ? 15 : 0);
}

export function ServicePartsHubStripFloorWidget() {
  const { data, isLoading, isError } = useServiceJobList({
    per_page: 30,
    include_closed: false,
  });

  const job = useMemo(
    () => [...(data?.jobs ?? [])].sort((a, b) => scorePartsJob(b) - scorePartsJob(a))[0] ?? null,
    [data],
  );

  return (
    <FloorWidgetShell
      title="Service parts hub"
      icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
      to="/service/parts"
      linkLabel="Queue"
      minHeight="min-h-[210px]"
    >
      {isLoading ? <LoadingLine /> : null}
      {isError ? <ErrorLine>Couldn't load service parts status.</ErrorLine> : null}
      {!isLoading && !isError && !job ? (
        <EmptyState
          icon={<PackageCheck className="h-6 w-6" aria-hidden="true" />}
          title="No open service jobs"
          body="Parts links stay ready here when the shop has active work."
        />
      ) : null}
      {!isLoading && !isError && job ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/70 px-3 py-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {job.customer?.name ?? job.requested_by_name ?? "Service job"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {job.customer_problem_summary ?? job.current_stage.replace(/_/g, " ")}
            </p>
          </div>
          <ServicePartsHubStrip
            jobId={job.id}
            fulfillmentRunId={job.fulfillment_run_id}
            variant="floor"
          />
        </div>
      ) : null}
    </FloorWidgetShell>
  );
}
