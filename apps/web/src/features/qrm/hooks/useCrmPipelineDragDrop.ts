import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { patchCrmDeal } from "../lib/qrm-api";
import type { QrmDealStage, QrmRepSafeDeal } from "../lib/types";

/**
 * Debounced invalidation of open deals after stage drag and optimistic updates.
 */
export function useCrmPipelineDragDrop(
  queryClient: QueryClient,
  hydratedDeals: QrmRepSafeDeal[] | null,
  setHydratedDeals: Dispatch<SetStateAction<QrmRepSafeDeal[] | null>>,
  stages?: QrmDealStage[],
  onGateRejection?: (message: string) => void,
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

      // Gate validation: check if the deal meets requirements for the target stage
      const deal = hydratedDealsRef.current?.find((d) => d.id === dealId);
      const targetStage = (stages ?? []).find((s) => s.id === newStageId);
      const targetOrder = targetStage?.sortOrder ?? 0;

      if (deal && targetOrder >= 17 && deal.depositStatus !== "verified") {
        // Hard gate: deposit must be verified for readiness/delivery stages
        onGateRejection?.("Deposit must be verified before entering this stage. Verify the deposit in the Approval Center first.");
        return;
      }

      if (deal && targetOrder >= 13 && targetOrder <= 16) {
        // Soft warning: low margin at close/funding stages
        const marginPct = (deal as unknown as Record<string, unknown>).marginPct as number | undefined;
        if (marginPct !== undefined && marginPct < 10) {
          onGateRejection?.("Low margin (" + marginPct.toFixed(1) + "%) — manager approval will be required at this stage.");
          // Soft warning — allow the move to continue (DB trigger handles the flag)
        }
      }

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
