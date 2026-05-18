import { useState, useMemo } from "react";
import { useTodayFeed } from "../hooks/useTodayFeed";
import { useAuth } from "@/hooks/useAuth";
import { EveningBriefingHero } from "../components/EveningBriefingHero";
import { MomentumStrip } from "../components/MomentumStrip";
import { TomorrowFirstMove } from "../components/TomorrowFirstMove";
import { LiveSignalsStrip } from "../components/LiveSignalsStrip";
import { EmptyStateQuickStart } from "../components/EmptyStateQuickStart";
import { PrepCard } from "../components/PrepCard";
import { ActionItemCard } from "../components/ActionItemCard";
import { LogVisitFlow } from "../components/LogVisitFlow";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Flame, Calendar, Plus } from "lucide-react";
import { formatRepFirstName } from "../lib/format-rep-name";

function formatCurrencyCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

interface BriefingCopy {
  headline: string | null;
  followup: string | null;
  assistantStatus: string;
}

function buildBriefingCopy(args: {
  timeOfDay: "morning" | "afternoon" | "evening";
  pipelineCount: number;
  pipelineValue: number;
  warmCount: number;
  coolingCount: number;
  closingSoonCount: number;
  quotesThisWeek: number;
}): BriefingCopy {
  const {
    timeOfDay,
    pipelineCount,
    pipelineValue,
    warmCount,
    coolingCount,
    closingSoonCount,
    quotesThisWeek,
  } = args;

  if (pipelineCount === 0) {
    return {
      headline: "JARVIS is warming up. Drop your first signal and I'll start scoring your book overnight.",
      followup: null,
      assistantStatus: "Ready",
    };
  }

  const pipelineLine = `${formatCurrencyCompact(pipelineValue)} across ${pipelineCount} ${pipelineCount === 1 ? "deal" : "deals"}`;
  const followupBits: string[] = [];
  if (closingSoonCount > 0) {
    followupBits.push(`${closingSoonCount} closing this week`);
  }
  if (coolingCount > 0) {
    followupBits.push(`${coolingCount} cooling`);
  }
  if (followupBits.length === 0 && warmCount > 0) {
    followupBits.push(`${warmCount} warm and engaged`);
  }
  if (followupBits.length === 0 && quotesThisWeek > 0) {
    followupBits.push(`${quotesThisWeek} quotes sent this week`);
  }
  const followup = followupBits.length > 0 ? followupBits.join(" · ") : null;

  if (timeOfDay === "evening") {
    return {
      headline: `Today's book: ${pipelineLine}.`,
      followup: followup ? `Tomorrow: ${followup}.` : "Tomorrow's prep is ready.",
      assistantStatus: "Briefing tomorrow",
    };
  }

  if (timeOfDay === "morning") {
    return {
      headline: `${pipelineLine} ready to move.`,
      followup,
      assistantStatus: "Scoring deals",
    };
  }

  return {
    headline: `${pipelineLine} in motion right now.`,
    followup,
    assistantStatus: "Watching signals",
  };
}

export function TodayFeedPage() {
  const {
    briefing,
    liveStats,
    livePriorityActions,
    pipeline,
    timeOfDay,
    isLoading,
  } = useTodayFeed();
  const { profile } = useAuth();
  const [logVisitOpen, setLogVisitOpen] = useState(false);

  const firstName = useMemo(
    () =>
      formatRepFirstName({
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
      }),
    [profile?.full_name, profile?.email],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const dealMap = new Map(pipeline.map((d) => [d.deal_id, d]));

  const allPriorities = [
    ...(briefing?.priority_actions ?? []),
    ...livePriorityActions,
  ];
  const seen = new Set<string>();
  const priorities = allPriorities.filter((p) => {
    if (!p.deal_id) return true;
    if (seen.has(p.deal_id)) return false;
    seen.add(p.deal_id);
    return true;
  });

  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const closingSoonCount = pipeline.filter(
    (d) =>
      d.expected_close_on &&
      new Date(d.expected_close_on).getTime() - now < week,
  ).length;
  const warmCount = pipeline.filter((d) => d.heat_status === "warm").length;
  const coolingCount = pipeline.filter(
    (d) => d.heat_status === "cooling" || d.heat_status === "cold",
  ).length;

  const briefingCopy = buildBriefingCopy({
    timeOfDay,
    pipelineCount: pipeline.length,
    pipelineValue: liveStats.total_pipeline_value,
    warmCount,
    coolingCount,
    closingSoonCount,
    quotesThisWeek: liveStats.quotes_sent_this_week,
  });

  const hasData = pipeline.length > 0 || Boolean(briefing);

  const handleVoiceDictate = () => setLogVisitOpen(true);

  return (
    <div className="px-4 py-4 space-y-5 max-w-lg mx-auto pb-8">
      <div className="flex items-center justify-between px-4 py-3 sm:hidden">
        <h1 className="text-xl font-bold text-foreground">Today</h1>
        <button
          type="button"
          aria-label="Log a visit"
          data-capture-trigger
          onClick={() => setLogVisitOpen(true)}
          className="w-10 h-10 rounded-full bg-qep-orange text-white flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <Sheet open={logVisitOpen} onOpenChange={setLogVisitOpen}>
        <SheetContent side="bottom">
          <LogVisitFlow onComplete={() => setLogVisitOpen(false)} />
        </SheetContent>
      </Sheet>

      <EveningBriefingHero
        firstName={firstName}
        timeOfDay={timeOfDay}
        headline={briefingCopy.headline}
        followup={briefingCopy.followup}
        assistantStatus={briefingCopy.assistantStatus}
        onVoicePress={handleVoiceDictate}
      />

      {hasData && (
        <MomentumStrip
          pipeline={pipeline}
          quotesThisWeek={liveStats.quotes_sent_this_week}
        />
      )}

      {pipeline.length > 0 && (
        <LiveSignalsStrip
          pipeline={pipeline}
          expiringQuoteCount={
            briefing?.expiring_quotes?.length ?? 0
          }
        />
      )}

      {pipeline.length > 0 && <TomorrowFirstMove pipeline={pipeline} />}

      {priorities.length > 0 && (
        <div>
          <SectionHeader
            icon={<Flame className="w-3.5 h-3.5 text-qep-orange" />}
            label="Priority Actions"
            trailing={`${priorities.length} items`}
          />
          <div className="space-y-3">
            {priorities.slice(0, 5).map((action, i) => (
              <ActionItemCard
                key={action.deal_id ?? i}
                action={action}
                deal={action.deal_id ? dealMap.get(action.deal_id) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {briefing?.prep_cards && briefing.prep_cards.length > 0 && (
        <div>
          <SectionHeader
            icon={<Calendar className="w-3.5 h-3.5 text-purple-400" />}
            label="Today's Meetings"
          />
          <div className="space-y-3">
            {briefing.prep_cards.map((card) => (
              <PrepCard
                key={card.customer_id ?? card.customer_name}
                card={card}
              />
            ))}
          </div>
        </div>
      )}

      {!hasData && (
        <EmptyStateQuickStart onLogVisit={() => setLogVisitOpen(true)} />
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  label,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 h-px bg-white/[0.06]" />
      {trailing && (
        <span className="text-[11px] text-muted-foreground/60 font-medium">
          {trailing}
        </span>
      )}
    </div>
  );
}
