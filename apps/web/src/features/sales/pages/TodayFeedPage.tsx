import { useTodayFeed } from "../hooks/useTodayFeed";
import { useAuth } from "@/hooks/useAuth";
import { AiBriefingCard } from "../components/AiBriefingCard";
import { PrepCard } from "../components/PrepCard";
import { ActionItemCard } from "../components/ActionItemCard";
import { PipelineSnapshot } from "../components/PipelineSnapshot";
import { DaySummaryCard } from "../components/DaySummaryCard";
import {
  TrendingUp,
  Flame,
  Calendar,
} from "lucide-react";
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Deal lookup map for enriching priority cards ──
  const dealMap = new Map(pipeline.map((d) => [d.deal_id, d]));

  // ── Merge & deduplicate priorities ──
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

  // ── Closing soon count for hero card ──
  const closingSoon = pipeline.filter(
    (d) =>
      d.expected_close_on &&
      new Date(d.expected_close_on).getTime() - Date.now() <
        7 * 24 * 60 * 60 * 1000,
  ).length;

  // ── First name extraction ──
  const firstName =
    profile?.full_name?.split(" ")[0] ?? "";

  const hasData = pipeline.length > 0 || briefing;

  return (
    <div className="px-4 py-4 space-y-5 max-w-lg mx-auto pb-8">
      {/* Hero Greeting */}
      <AiBriefingCard
        firstName={firstName}
        timeOfDay={timeOfDay}
        pipelineValue={liveStats.total_pipeline_value}
        closingSoonCount={closingSoon}
        priorityCount={priorities.length}
      />

      {/* Pipeline Snapshot */}
      <PipelineSnapshot stats={liveStats} />

      {/* Priority Actions */}
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

      {/* Today's Meetings / Prep Cards */}
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

      {/* Evening Summary */}
      {timeOfDay === "evening" && <DaySummaryCard pipeline={pipeline} />}

      {/* Empty state */}
      {!hasData && (
        <div className="text-center py-16 px-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-qep-orange/10 rounded-full flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-qep-orange" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Your Sales Companion is ready
          </h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Start by logging a visit or adding a deal. Your AI-powered briefing
            will generate overnight with priorities, prep cards, and
            opportunities.
          </p>
          <button
            onClick={() => {
              const plusBtn = document.querySelector(
                "[data-capture-trigger]",
              ) as HTMLButtonElement;
              plusBtn?.click();
            }}
            className="mt-4 px-6 py-2.5 bg-qep-orange text-white rounded-full text-sm font-semibold shadow-md hover:shadow-lg transition-shadow"
          >
            Log Your First Visit
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Reusable section header ─────────────────────────── */
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
