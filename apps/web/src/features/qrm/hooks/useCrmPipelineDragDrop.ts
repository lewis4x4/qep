import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { patchCrmDeal, reorderPipelineDeals } from "../lib/qrm-api";
import type { QrmDealStage, QrmRepSafeDeal } from "../lib/types";
import { evaluateStageGate, evaluateStageGateForSelection } from "../lib/pipeline-gates";

/**
 * Debounced invalidation of open deals after stage drag and optimistic updates.
 *
 * Slice 2.4 additions:
 *   - Pure gate evaluation via `evaluateStageGate`
 *   - `gateRejectedStageId` state so the column can paint red during drag-over
 *   - Multi-select drag: when `selectedDealIds` includes the active deal, the
 *     whole selection moves together (a single gate evaluation governs the
 *     batch; a block rejects all)
 *   - Intra-column reorder via `reorderPipelineDeals` RPC
 */
export function useCrmPipelineDragDrop(
  queryClient: QueryClient,
  hydratedDeals: QrmRepSafeDeal[] | null,
  setHydratedDeals: Dispatch<SetStateAction<QrmRepSafeDeal[] | null>>,
  stages?: QrmDealStage[],
  onGateRejection?: (message: string) => void,
  selectedDealIds?: Set<string>,
  clearSelection?: () => void,
): {
  activeDragDealId: string | null;
  gateRejectedStageId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
  schedulePipelineRefresh: (dealId: string) => void;
} {
  const pipelineRefreshTimeoutRef = useRef<number | null>(null);
  const refreshedDealIdsRef = useRef<Set<string>>(new Set());
  const hydratedDealsRef = useRef(hydratedDeals);
  hydratedDealsRef.current = hydratedDeals;
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const selectedDealIdsRef = useRef(selectedDealIds);
  selectedDealIdsRef.current = selectedDealIds;

  const [activeDragDealId, setActiveDragDealId] = useState<string | null>(null);
  const [gateRejectedStageId, setGateRejectedStageId] = useState<string | null>(null);
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

  /** Resolve the set of deals that should move together when dragging `activeDealId`. */
  const resolveDragSelection = useCallback((activeDealId: string): QrmRepSafeDeal[] => {
    const deals = hydratedDealsRef.current ?? [];
    const active = deals.find((d) => d.id === activeDealId);
    if (!active) return [];

    const selected = selectedDealIdsRef.current;
    if (selected && selected.size > 1 && selected.has(activeDealId)) {
      // Multi-select: pull the rest of the selected set that's still in the same
      // origin stage. Cross-stage drags honor only the active card to avoid
      // accidentally moving deals from other columns.
      return deals.filter((d) => selected.has(d.id) && d.stageId === active.stageId);
    }
    return [active];
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dealId = event.active.id as string;
    setActiveDragDealId(dealId);
    const deal = hydratedDealsRef.current?.find((d) => d.id === dealId);
    if (deal) {
      dragOriginalStageRef.current.set(dealId, deal.stageId);
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!active || !over) {
      setGateRejectedStageId(null);
      return;
    }
    const activeDealId = active.id as string;
    const overId = over.id as string;

    // The droppable id is either a stage id (DroppableStageColumn) or another
    // deal id (sortable item). In the latter case, resolve the stage via the
    // deal's current stage.
    const stages = stagesRef.current ?? [];
    const targetStage = stages.find((s) => s.id === overId)
      ?? stages.find((s) => s.id === (hydratedDealsRef.current?.find((d) => d.id === overId)?.stageId));
    if (!targetStage) {
      setGateRejectedStageId(null);
      return;
    }
    const dragging = resolveDragSelection(activeDealId);
    const result = evaluateStageGateForSelection(dragging, targetStage);
    setGateRejectedStageId(result.severity === "block" ? targetStage.id : null);
  }, [resolveDragSelection]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragDealId(null);
      setGateRejectedStageId(null);
      const { active, over } = event;
      if (!over || !active) return;

      const dealId = active.id as string;
      const overId = over.id as string;
      const originalStageId = dragOriginalStageRef.current.get(dealId);
      dragOriginalStageRef.current.delete(dealId);
      if (!originalStageId) return;

      const stages = stagesRef.current ?? [];
      const hydratedDealsNow = hydratedDealsRef.current ?? [];

      // Resolve the target stage. overId can be a stage id OR a sortable deal id.
      let targetStageId = overId;
      const overDeal = hydratedDealsNow.find((d) => d.id === overId);
      if (overDeal) {
        targetStageId = overDeal.stageId;
      }

      const targetStage = stages.find((s) => s.id === targetStageId);
      if (!targetStage) return;

      // Multi-select: resolve the set to move together. Single-select yields
      // a one-item array containing the active deal.
      const draggingDeals = resolveDragSelection(dealId);
      if (draggingDeals.length === 0) return;

      // Gate evaluation — blocks hard-rejected drops; warn results proceed.
      const gate = evaluateStageGateForSelection(draggingDeals, targetStage);
      if (gate.severity === "block") {
        if (gate.message) onGateRejection?.(gate.message);
        return;
      }
      if (gate.severity === "warn" && gate.message) {
        onGateRejection?.(gate.message);
      }

      // Cross-stage move — transition every dragging deal, then reorder.
      const isCrossStage = targetStageId !== originalStageId;

      if (isCrossStage) {
        const dealIds = draggingDeals.map((d) => d.id);
        // Optimistic update: move all cards to new stage.
        setHydratedDeals((current) =>
          current?.map((d) => (dealIds.includes(d.id) ? { ...d, stageId: targetStageId } : d)) ?? current,
        );

        try {
          await Promise.all(dealIds.map((id) => patchCrmDeal(id, { stageId: targetStageId })));
          // After stage transition, append to the end of the target column's
          // current order. We read the board's current list, filter to target
          // stage, drop the moved ids (they were just relocated), and commit
          // [...existing, ...movedIds] back via the reorder RPC.
          const boardNow = hydratedDealsRef.current ?? [];
          const existing = boardNow
            .filter((d) => d.stageId === targetStageId && !dealIds.includes(d.id))
            .sort((a, b) => (a.sortPosition ?? Infinity) - (b.sortPosition ?? Infinity) || a.createdAt.localeCompare(b.createdAt))
            .map((d) => d.id);
          const newOrder = [...existing, ...dealIds];
          await reorderPipelineDeals(targetStageId, newOrder);
          dealIds.forEach((id) => schedulePipelineRefresh(id));
          if (draggingDeals.length > 1) clearSelection?.();
        } catch (err) {
          // Rollback: restore origin stage.
          setHydratedDeals((current) =>
            current?.map((d) => (dealIds.includes(d.id) ? { ...d, stageId: originalStageId } : d)) ?? current,
          );
          console.error("Stage transition failed:", err);
          onGateRejection?.("Could not move the deal(s). Please try again.");
        }
        return;
      }

      // Intra-column reorder. Only meaningful when hovering over another deal
      // card (SortableContext emits overId = other deal id).
      if (!overDeal || overDeal.id === dealId) return;

      const columnDeals = hydratedDealsNow
        .filter((d) => d.stageId === originalStageId)
        .sort((a, b) => (a.sortPosition ?? Infinity) - (b.sortPosition ?? Infinity) || a.createdAt.localeCompare(b.createdAt));

      const oldIndex = columnDeals.findIndex((d) => d.id === dealId);
      const newIndex = columnDeals.findIndex((d) => d.id === overDeal.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      const reordered = [...columnDeals];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      const newOrder = reordered.map((d) => d.id);

      // Optimistic local update so the card lands in place before the RPC
      // returns. We rewrite sort_position in 100-unit steps matching the
      // server-side convention.
      setHydratedDeals((current) => {
        if (!current) return current;
        const newPositions = new Map<string, number>();
        newOrder.forEach((id, idx) => newPositions.set(id, (idx + 1) * 100));
        return current.map((d) => {
          const pos = newPositions.get(d.id);
          return pos === undefined ? d : { ...d, sortPosition: pos };
        });
      });

      try {
        await reorderPipelineDeals(originalStageId, newOrder);
      } catch (err) {
        console.error("Pipeline reorder failed:", err);
        onGateRejection?.("Could not save the new order. Reloading the board.");
        schedulePipelineRefresh(dealId);
      }
    },
    [schedulePipelineRefresh, setHydratedDeals, resolveDragSelection, onGateRejection, clearSelection],
  );

  return {
    activeDragDealId,
    gateRejectedStageId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    schedulePipelineRefresh,
  };
}
