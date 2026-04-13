import { useQuery } from "@tanstack/react-query";
import { fetchTodayBriefing, fetchRepPipeline } from "../lib/sales-api";
import type { BriefingContent, PipelineStats, PriorityAction, RepPipelineDeal } from "../lib/types";

function getTimeOfDay(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function useTodayFeed() {
  const briefingQuery = useQuery({
    queryKey: ["sales", "briefing", new Date().toISOString().split("T")[0]],
    queryFn: fetchTodayBriefing,
    staleTime: 60 * 60 * 1000, // 1 hour — briefing is generated once daily
  });

  const pipelineQuery = useQuery({
    queryKey: ["sales", "pipeline"],
    queryFn: fetchRepPipeline,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const timeOfDay = getTimeOfDay();
  const briefing = briefingQuery.data?.briefing_content ?? null;
  const pipeline = pipelineQuery.data ?? [];

  // Compute live stats from pipeline data
  const liveStats: PipelineStats = {
    deals_in_pipeline: pipeline.length,
    total_pipeline_value: pipeline.reduce(
      (sum, d) => sum + (d.amount ?? 0),
      0,
    ),
    quotes_sent_this_week: briefing?.stats?.quotes_sent_this_week ?? 0,
  };

  // Merge live urgency signals on top of AI briefing
  const urgentDeals = pipeline.filter(
    (d) => d.heat_status === "cold" || d.heat_status === "cooling",
  );

  const livePriorityActions: PriorityAction[] = urgentDeals
    .slice(0, 3)
    .map((d) => ({
      type: d.heat_status === "cold" ? "going_cold" : "cooling",
      customer_name: d.customer_name,
      deal_id: d.deal_id,
      summary: `${d.deal_name} — ${d.days_since_activity ?? "?"}d since activity, $${(d.amount ?? 0).toLocaleString()}`,
    }));

  return {
    briefing,
    liveStats,
    livePriorityActions,
    pipeline,
    timeOfDay,
    isLoading: briefingQuery.isLoading || pipelineQuery.isLoading,
    error: briefingQuery.error || pipelineQuery.error,
  };
}
