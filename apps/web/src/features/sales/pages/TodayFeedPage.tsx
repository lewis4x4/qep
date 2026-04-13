import { useTodayFeed } from "../hooks/useTodayFeed";
import { AiBriefingCard } from "../components/AiBriefingCard";
import { PrepCard } from "../components/PrepCard";
import { ActionItemCard } from "../components/ActionItemCard";
import { PipelineSnapshot } from "../components/PipelineSnapshot";
import { DaySummaryCard } from "../components/DaySummaryCard";

export function TodayFeedPage() {
  const {
    briefing,
    liveStats,
    livePriorityActions,
    pipeline,
    timeOfDay,
    isLoading,
  } = useTodayFeed();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const allPriorities = [
    ...(briefing?.priority_actions ?? []),
    ...livePriorityActions,
  ];

  // Deduplicate by deal_id
  const seen = new Set<string>();
  const priorities = allPriorities.filter((p) => {
    if (!p.deal_id) return true;
    if (seen.has(p.deal_id)) return false;
    seen.add(p.deal_id);
    return true;
  });

  return (
    <div className="px-4 py-4 space-y-3 max-w-lg mx-auto">
      {/* Greeting */}
      <AiBriefingCard
        greeting={briefing?.greeting ?? `Good ${timeOfDay}. Here's your day.`}
        priorityCount={priorities.length}
      />

      {/* Pipeline snapshot */}
      <PipelineSnapshot stats={liveStats} />

      {/* Priority actions */}
      {priorities.slice(0, 5).map((action, i) => (
        <ActionItemCard key={action.deal_id ?? i} action={action} />
      ))}

      {/* Prep cards */}
      {briefing?.prep_cards?.map((card) => (
        <PrepCard key={card.customer_id ?? card.customer_name} card={card} />
      ))}

      {/* Opportunities */}
      {briefing?.opportunities?.map((opp, i) => (
        <div
          key={i}
          className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <span className="text-emerald-600 text-lg mt-0.5">
              {opp.type === "trade_in_approaching" ? "\u2191" : "\u2605"}
            </span>
            <div>
              <p className="text-sm font-medium text-emerald-900">
                Opportunity
              </p>
              <p className="text-sm text-emerald-700 mt-0.5">{opp.summary}</p>
            </div>
          </div>
        </div>
      ))}

      {/* Evening summary */}
      {timeOfDay === "evening" && (
        <DaySummaryCard pipeline={pipeline} />
      )}

      {/* Empty state */}
      {!briefing && priorities.length === 0 && (
        <div className="text-center py-12">
          <p className="text-slate-500 text-sm">
            No briefing available yet. Check back tomorrow morning.
          </p>
        </div>
      )}
    </div>
  );
}
