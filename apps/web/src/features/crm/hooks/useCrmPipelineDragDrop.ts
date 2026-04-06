import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { patchCrmDeal } from "../lib/crm-api";
import type { CrmRepSafeDeal } from "../lib/types";

/**
 * Debounced invalidation of open deals after stage drag and optimistic updates.
 */
export function useCrmPipelineDragDrop(
  queryClient: QueryClient,
  hydratedDeals: CrmRepSafeDeal[] | null,
  setHydratedDeals: Dispatch<SetStateAction<CrmRepSafeDeal[] | null>>,
): {
  activeDragDealId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
  schedulePipelineRefresh: (dealId: string) => void;
} {
  const pipelineRefreshTimeoutRef = useRef<number | null>(null);
  const refreshedDealIdsRef = useRef<Set<string>>(new Set());
  const hydratedDealsRef = useRef(hydratedDeals);
  hydratedDealsRef.current = hydratedDeals;

  const [activeDragDealId, setActiveDragDealId] = useState<string | null>(null);
  const dragOriginalStageRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      if (pipelineRefreshTimeoutRef.current !== null) {
        window.clearTimeout(pipelineRefreshTimeoutRef.current);
      }
      refreshedDealIdsRef.current.clear();
    };
  }, []);

  const schedulePipelineRefresh = useCallback(
    (dealId: string): void => {
      refreshedDealIdsRef.current.add(dealId);

      if (typeof window === "undefined") {
        void queryClient.invalidateQueries({ queryKey: ["crm", "deals", "open-table"] }).finally(() => {
          refreshedDealIdsRef.current.clear();
        });
        return;
      }

      if (pipelineRefreshTimeoutRef.current !== null) {
        window.clearTimeout(pipelineRefreshTimeoutRef.current);
      }

      pipelineRefreshTimeoutRef.current = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["crm", "deals", "open-table"] }).finally(() => {
          refreshedDealIdsRef.current.clear();
        });
        pipelineRefreshTimeoutRef.current = null;
      }, 2000);
    },
    [queryClient],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dealId = event.active.id as string;
    setActiveDragDealId(dealId);
    const deal = hydratedDealsRef.current?.find((d) => d.id === dealId);
    if (deal) {
      dragOriginalStageRef.current.set(dealId, deal.stageId);
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragDealId(null);
      const { active, over } = event;
      if (!over || !active) return;

      const dealId = active.id as string;
      const newStageId = over.id as string;
      const originalStageId = dragOriginalStageRef.current.get(dealId);
      dragOriginalStageRef.current.delete(dealId);

      if (!originalStageId || originalStageId === newStageId) return;

      setHydratedDeals((current) =>
        current?.map((d) => (d.id === dealId ? { ...d, stageId: newStageId } : d)) ?? current,
      );

      try {
        await patchCrmDeal(dealId, { stageId: newStageId });
        schedulePipelineRefresh(dealId);
      } catch (err) {
        setHydratedDeals((current) =>
          current?.map((d) => (d.id === dealId ? { ...d, stageId: originalStageId } : d)) ?? current,
        );
        console.error("Stage transition failed:", err);
      }
    },
    [schedulePipelineRefresh, setHydratedDeals],
  );

  return {
    activeDragDealId,
    handleDragStart,
    handleDragEnd,
    schedulePipelineRefresh,
  };
}
