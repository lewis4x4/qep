import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTodayBriefing, fetchRepPipeline } from "../lib/sales-api";
import { fetchRepPriceImpacts } from "@/features/price-intelligence/lib/price-intelligence-api";
import { REP_PRICE_IMPACTS_QUERY_KEY } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import type { BriefingContent, PipelineStats, PriorityAction, RepPipelineDeal } from "../lib/types";

type DraftPlaybookFeedRow = {
  id: string;
  deal_id: string | null;
  total_revenue: number;
  company_name: string | null;
};

/** N2.1: the rep's draft 30/60/90 parts plans awaiting review-and-send. */
async function fetchMyDraftPlaybooks(): Promise<DraftPlaybookFeedRow[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from("post_sale_parts_playbooks")
    .select("id, deal_id, total_revenue, qrm_companies:company_id(name)")
    .eq("assigned_rep_id", auth.user.id)
    .in("status", ["draft", "reviewed"])
    .order("total_revenue", { ascending: false })
    .limit(3);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown> & { qrm_companies?: { name?: string | null } | null };
    return {
      id: String(record.id),
      deal_id: (record.deal_id as string | null) ?? null,
      total_revenue: Number(record.total_revenue ?? 0),
      company_name: record.qrm_companies?.name ?? null,
    };
  });
}

function getTimeOfDay(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      setReady(true);
      return;
    }

    let timeoutId: number | undefined;
    let rafId: number | undefined;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;

    const markReady = () => setReady(true);
    rafId = window.requestAnimationFrame(() => {
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(markReady, { timeout: 1500 });
        return;
      }
      timeoutId = window.setTimeout(markReady, 0);
    });

    return () => {
      if (rafId !== undefined) window.cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
    };
  }, []);

  return ready;
}

export function useTodayFeed() {
  const loadBriefingAfterFirstPaint = useAfterFirstPaint();
  const briefingQuery = useQuery({
    queryKey: ["sales", "briefing", new Date().toISOString().split("T")[0]],
    queryFn: fetchTodayBriefing,
    enabled: loadBriefingAfterFirstPaint,
    staleTime: 60 * 60 * 1000, // 1 hour — briefing is generated once daily
  });

  const pipelineQuery = useQuery({
    queryKey: ["sales", "pipeline"],
    queryFn: fetchRepPipeline,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const priceImpactsQuery = useQuery({
    queryKey: REP_PRICE_IMPACTS_QUERY_KEY,
    queryFn: fetchRepPriceImpacts,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const draftPlaybooksQuery = useQuery({
    queryKey: ["sales", "draft-playbooks"],
    queryFn: fetchMyDraftPlaybooks,
    staleTime: 5 * 60 * 1000,
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

  // N2.1: draft 30/60/90 parts plans ride the same priority-actions block.
  for (const playbook of draftPlaybooksQuery.data ?? []) {
    livePriorityActions.push({
      type: "parts_playbook",
      customer_name: playbook.company_name,
      deal_id: playbook.deal_id,
      summary: `Review & send the 30/60/90 parts plan — $${Math.round(playbook.total_revenue).toLocaleString()} parts revenue on the table`,
    });
  }

  return {
    briefing,
    liveStats,
    livePriorityActions,
    pipeline,
    priceImpacts: priceImpactsQuery.data ?? null,
    priceImpactsLoading: priceImpactsQuery.isLoading,
    priceImpactsError: priceImpactsQuery.error,
    timeOfDay,
    // Keep the LLM-backed briefing off the first-paint loading gate. The
    // locally-derived hero/action copy can render from the fast pipeline path;
    // AI prep/priority cards hydrate when the briefing query resolves after
    // first paint. Price impacts stay in the gate to avoid mid-page OEM card CLS.
    isLoading: pipelineQuery.isLoading || priceImpactsQuery.isLoading,
    error: pipelineQuery.error || priceImpactsQuery.error || briefingQuery.error,
    briefingError: briefingQuery.error,
    pipelineError: pipelineQuery.error,
    hasBriefing: Boolean(briefing),
  };
}
