/**
 * AdvisorBriefingBanner — full-width collapsible AI briefing band.
 *
 * Pinned to the very top of the iron_advisor /floor page. Replaces the
 * old rail-mounted SalesAiBriefingFloorWidget so the personal AI
 * greeting reads as a header banner rather than a rail card. Collapse
 * state persists per-user via localStorage so reps who collapse it
 * stay collapsed across sessions.
 */
import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTodayFeed } from "@/features/sales/hooks/useTodayFeed";
import { AiBriefingCard } from "@/features/sales/components/AiBriefingCard";
import type { RepPipelineDeal } from "@/features/sales/lib/types";

const STORAGE_KEY = "qep:floor:advisor-briefing-collapsed";

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

export function AdvisorBriefingBanner() {
  const { profile } = useAuth();
  const { liveStats, livePriorityActions, pipeline, timeOfDay, isLoading, error } =
    useTodayFeed();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

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
        <div className="border-t border-[#f28a07]/30 p-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading today's briefing…
            </div>
          ) : null}
          {error ? (
            <p className="text-xs text-rose-300">
              Couldn't load today's briefing right now.
            </p>
          ) : null}
          {!isLoading && !error ? (
            <AiBriefingCard
              firstName={firstName}
              timeOfDay={timeOfDay}
              pipelineValue={liveStats.total_pipeline_value}
              closingSoonCount={closingSoonCount(pipeline)}
              priorityCount={livePriorityActions.length}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
