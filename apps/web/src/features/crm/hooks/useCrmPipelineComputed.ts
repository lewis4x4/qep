import { useMemo } from "react";
import type { CrmDealStage, CrmRepSafeDeal } from "../lib/types";
import { getDealSignalState } from "../lib/deal-signals";
import { getFollowUpSortTime } from "../lib/pipeline-utils";
import type { DealUrgencyState } from "../lib/pipeline-utils";

export type UrgencyFilter =
  | "all"
  | "overdue_follow_up"
  | "no_follow_up"
  | "stalled"
  | "data_issues"
  | "attention";

export function useCrmPipelineComputed(
  stages: CrmDealStage[] | undefined,
  selectedStageId: string,
  urgencyFilter: UrgencyFilter,
  deferredOpenDeals: CrmRepSafeDeal[],
): {
  stageNameById: Map<string, string>;
  stageOptions: { id: string; name: string }[];
  stageFilteredDeals: CrmRepSafeDeal[];
  urgencyEvaluation: {
    counts: Record<UrgencyFilter, number>;
    byDealId: Map<string, DealUrgencyState>;
  };
  filteredDeals: CrmRepSafeDeal[];
  stageSummary: Array<{
    stageId: string;
    stageName: string;
    count: number;
    amount: number;
  }>;
  stageColumns: Array<{
    stageId: string;
    stageName: string;
    deals: CrmRepSafeDeal[];
    amount: number;
  }>;
} {
  const stageNameById = useMemo(() => {
    return new Map((stages ?? []).map((stage) => [stage.id, stage.name]));
  }, [stages]);

  const stageOptions = useMemo(() => {
    return (stages ?? [])
      .filter((stage) => !stage.isClosedWon && !stage.isClosedLost)
      .map((stage) => ({ id: stage.id, name: stage.name }));
  }, [stages]);

  const stageFilteredDeals = useMemo(() => {
    if (selectedStageId === "all") {
      return deferredOpenDeals;
    }
    return deferredOpenDeals.filter((deal) => deal.stageId === selectedStageId);
  }, [deferredOpenDeals, selectedStageId]);

  const urgencyEvaluation = useMemo(() => {
    const now = Date.now();
    const byDealId = new Map<string, DealUrgencyState>();
    const counts: Record<UrgencyFilter, number> = {
      all: stageFilteredDeals.length,
      overdue_follow_up: 0,
      no_follow_up: 0,
      stalled: 0,
      data_issues: 0,
      attention: 0,
    };

    for (const deal of stageFilteredDeals) {
      const { isOverdueFollowUp, isStalled } = getDealSignalState(deal, now);
      const hasNoFollowUp = !deal.nextFollowUpAt;
      const hasDataIssue =
        (deal.nextFollowUpAt !== null && !Number.isFinite(Date.parse(deal.nextFollowUpAt))) ||
        (deal.lastActivityAt !== null && !Number.isFinite(Date.parse(deal.lastActivityAt)));
      const needsAttention = isOverdueFollowUp || hasNoFollowUp || isStalled || hasDataIssue;
      const state: DealUrgencyState = {
        isOverdueFollowUp,
        hasNoFollowUp,
        isStalled,
        hasDataIssue,
        needsAttention,
      };

      byDealId.set(deal.id, state);

      if (state.isOverdueFollowUp) counts.overdue_follow_up += 1;
      if (state.hasNoFollowUp) counts.no_follow_up += 1;
      if (state.isStalled) counts.stalled += 1;
      if (state.hasDataIssue) counts.data_issues += 1;
      if (state.needsAttention) counts.attention += 1;
    }

    return { counts, byDealId };
  }, [stageFilteredDeals]);

  const filteredDeals = useMemo(() => {
    if (urgencyFilter === "all") return stageFilteredDeals;

    return stageFilteredDeals.filter((deal) => {
      const state = urgencyEvaluation.byDealId.get(deal.id);
      if (!state) return false;
      if (urgencyFilter === "overdue_follow_up") return state.isOverdueFollowUp;
      if (urgencyFilter === "no_follow_up") return state.hasNoFollowUp;
      if (urgencyFilter === "stalled") return state.isStalled;
      if (urgencyFilter === "data_issues") return state.hasDataIssue;
      return state.needsAttention;
    });
  }, [stageFilteredDeals, urgencyFilter, urgencyEvaluation.byDealId]);

  const stageSummary = useMemo(() => {
    const byStage = new Map<string, { count: number; amount: number }>();
    for (const deal of deferredOpenDeals) {
      const current = byStage.get(deal.stageId) ?? { count: 0, amount: 0 };
      current.count += 1;
      current.amount += deal.amount ?? 0;
      byStage.set(deal.stageId, current);
    }
    return Array.from(byStage.entries()).map(([stageId, value]) => ({
      stageId,
      stageName: stageNameById.get(stageId) ?? "Unknown stage",
      count: value.count,
      amount: value.amount,
    }));
  }, [deferredOpenDeals, stageNameById]);

  const stageColumns = useMemo(() => {
    const openStages =
      stageOptions.length > 0
        ? stageOptions
        : Array.from(stageNameById.entries()).map(([id, name]) => ({ id, name }));
    const visibleStages =
      selectedStageId === "all"
        ? openStages
        : openStages.filter((stage) => stage.id === selectedStageId);

    return visibleStages.map((stage) => {
      const deals = filteredDeals
        .filter((deal) => deal.stageId === stage.id)
        .sort((a, b) => {
          const nextA = getFollowUpSortTime(a.nextFollowUpAt);
          const nextB = getFollowUpSortTime(b.nextFollowUpAt);
          if (nextA !== nextB) return nextA - nextB;
          return (b.amount ?? 0) - (a.amount ?? 0);
        });
      const amount = deals.reduce((total, deal) => total + (deal.amount ?? 0), 0);
      return { stageId: stage.id, stageName: stage.name, deals, amount };
    });
  }, [filteredDeals, selectedStageId, stageOptions, stageNameById]);

  return {
    stageNameById,
    stageOptions,
    stageFilteredDeals,
    urgencyEvaluation,
    filteredDeals,
    stageSummary,
    stageColumns,
  };
}
