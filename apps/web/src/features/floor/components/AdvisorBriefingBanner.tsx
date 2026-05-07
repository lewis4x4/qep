/**
 * AdvisorBriefingBanner — full-width collapsible AI briefing band.
 *
 * Pinned to the very top of the iron_advisor /floor page. Replaces the
 * old rail-mounted SalesAiBriefingFloorWidget so the personal AI
 * greeting reads as a header banner rather than a rail card. Collapse
 * state persists per-user via localStorage so reps who collapse it
 * stay collapsed across sessions.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTodayFeed } from "@/features/sales/hooks/useTodayFeed";
import { AiBriefingCard } from "@/features/sales/components/AiBriefingCard";
import type { PriorityAction, RepPipelineDeal } from "@/features/sales/lib/types";
import {
  fetchAdvisorPipelineStats,
  formatCompactUsd,
  type AdvisorPipelineStats,
} from "@/features/floor/lib/advisor-home-stats";

const STORAGE_KEY = "qep:floor:advisor-briefing-collapsed";
const TRUE_EMPTY_SUMMARY =
  "No quote work queued yet. Start a quote or dictate one from your next customer conversation.";
const DEGRADED_EMPTY_SUMMARY =
  "Advisor briefing data is partially unavailable, and no live selling signals loaded. Refresh to retry, or start a quote to seed today’s motion.";

function closingSoonCount(pipeline: RepPipelineDeal[]): number {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  return pipeline.filter((deal) => {
    if (!deal.expected_close_on) return false;
    const diff = new Date(deal.expected_close_on).getTime() - now;
    return diff >= 0 && diff < week;
  }).length;
}

function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

function countDistinctPriorityActions(actions: PriorityAction[]): number {
  const seenDealIds = new Set<string>();
  let count = 0;

  for (const action of actions) {
    if (action.deal_id) {
      if (seenDealIds.has(action.deal_id)) continue;
      seenDealIds.add(action.deal_id);
    }
    count += 1;
  }

  return count;
}

function buildAdvisorSummaryParts({
  advisorPipelineStats,
  salesPipelineValue,
  salesClosingSoonCount,
  priorityCount,
}: {
  advisorPipelineStats: AdvisorPipelineStats | null;
  salesPipelineValue: number;
  salesClosingSoonCount: number;
  priorityCount: number;
}): string[] {
  const parts: string[] = [];

  if (advisorPipelineStats?.totalValueCents && advisorPipelineStats.totalValueCents > 0) {
    parts.push(`${formatCompactUsd(advisorPipelineStats.totalValueCents)} in QRM active pipeline`);
  } else if (salesPipelineValue > 0) {
    parts.push(`$${salesPipelineValue.toLocaleString()} in Sales Companion pipeline`);
  }

  if (advisorPipelineStats?.activeDealCount && advisorPipelineStats.activeDealCount > 0) {
    parts.push(
      `${advisorPipelineStats.activeDealCount} active deal${advisorPipelineStats.activeDealCount === 1 ? "" : "s"}`,
    );
  }

  if (advisorPipelineStats?.decisionCount && advisorPipelineStats.decisionCount > 0) {
    parts.push(
      `${advisorPipelineStats.decisionCount} at decision stage`,
    );
  }

  if (salesClosingSoonCount > 0) {
    parts.push(
      `${salesClosingSoonCount} deal${salesClosingSoonCount === 1 ? "" : "s"} closing this week`,
    );
  }

  if (priorityCount > 0) {
    parts.push(`${priorityCount} priority action${priorityCount === 1 ? "" : "s"} today`);
  }

  return parts;
}

export function AdvisorBriefingBanner() {
  const { profile, user } = useAuth();
  const {
    briefing,
    liveStats,
    livePriorityActions,
    pipeline,
    timeOfDay,
    isLoading,
    briefingError,
    pipelineError,
  } = useTodayFeed();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);
  const advisorUserId = user?.id ?? profile?.id ?? null;
  const advisorPipelineQuery = useQuery({
    queryKey: ["floor", "advisor", "briefing-pipeline", advisorUserId],
    queryFn: () => fetchAdvisorPipelineStats(advisorUserId as string),
    enabled: Boolean(advisorUserId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const firstName = profile?.full_name?.split(" ")[0] ?? "";
  const briefingLabel =
    timeOfDay === "morning"
      ? "Morning briefing"
      : timeOfDay === "afternoon"
        ? "Afternoon briefing"
        : "Evening briefing";
  const salesClosingSoonCount = closingSoonCount(pipeline);
  const advisorPipelineStats = advisorPipelineQuery.data ?? null;
  const qrmUnavailable = Boolean(advisorUserId && advisorPipelineQuery.error);
  const dailyFeedUnavailable = Boolean(briefingError);
  const salesPipelineUnavailable = Boolean(pipelineError);
  const allSourcesFailed =
    dailyFeedUnavailable && salesPipelineUnavailable && (qrmUnavailable || !advisorUserId);
  const priorityCount = countDistinctPriorityActions([
    ...(briefing?.priority_actions ?? []),
    ...livePriorityActions,
  ]);
  const summaryParts = useMemo(
    () =>
      buildAdvisorSummaryParts({
        advisorPipelineStats,
        salesPipelineValue: liveStats.total_pipeline_value,
        salesClosingSoonCount,
        priorityCount,
      }),
    [advisorPipelineStats, liveStats.total_pipeline_value, priorityCount, salesClosingSoonCount],
  );
  const emptySummary =
    dailyFeedUnavailable || salesPipelineUnavailable || qrmUnavailable
      ? DEGRADED_EMPTY_SUMMARY
      : TRUE_EMPTY_SUMMARY;
  const loading = isLoading || Boolean(advisorUserId && advisorPipelineQuery.isLoading);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[#f28a07]/35 bg-gradient-to-r from-[#f28a07]/15 via-[#f28a07]/8 to-transparent"
      aria-label="AI briefing"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-[#f28a07]/12"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-[#f6a53a]" aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#f6a53a]">
            AI Briefing
          </span>
          <span className="hidden text-[11px] uppercase tracking-[0.16em] text-[#f6a53a]/70 sm:inline">
            · {briefingLabel}
          </span>
          {firstName ? (
            <span className="ml-1 hidden truncate text-xs font-semibold text-slate-200 md:inline">
              · Good {timeOfDay}, {firstName}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#f6a53a] transition-transform ${collapsed ? "" : "rotate-180"}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed ? (
        <div className="space-y-2 border-t border-[#f28a07]/30 p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading today's briefing…
            </div>
          ) : null}
          {!loading && allSourcesFailed ? (
            <p className="text-xs text-rose-300">
              Couldn't load advisor briefing signals right now. Start a quote or dictate the customer conversation, and refresh the briefing after the signal syncs.
            </p>
          ) : null}
          {!loading && !allSourcesFailed ? (
            <>
              {dailyFeedUnavailable ? (
                <p className="text-xs text-amber-200/90">
                  Daily briefing unavailable; showing live advisor signals.
                </p>
              ) : null}
              {salesPipelineUnavailable ? (
                <p className="text-xs text-amber-200/90">
                  Sales Companion pipeline unavailable; showing remaining advisor signals.
                </p>
              ) : null}
              {qrmUnavailable ? (
                <p className="text-xs text-amber-200/90">
                  QRM advisor signals unavailable; showing Sales Companion briefing.
                </p>
              ) : null}
              <AiBriefingCard
                firstName={firstName}
                timeOfDay={timeOfDay}
                pipelineValue={advisorPipelineStats ? advisorPipelineStats.totalValueCents / 100 : liveStats.total_pipeline_value}
                closingSoonCount={salesClosingSoonCount}
                priorityCount={priorityCount}
                summaryParts={summaryParts}
                emptySummary={emptySummary}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
