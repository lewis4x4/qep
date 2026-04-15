import { memo, type MouseEvent as ReactMouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { PipelineDealCard } from "./PipelineDealCard";
import type { QrmRepSafeDeal } from "../lib/types";

/**
 * Sortable deal card for the pipeline board.
 *
 * Uses `useSortable` (not `useDraggable`) so cards can be reordered within
 * their SortableContext — that's the backbone of Slice 2.4 intra-column
 * reordering. The sortable behavior also continues to emit drag events at the
 * column boundary, so cross-stage moves keep working.
 *
 * Multi-select:
 *   - `isSelected` paints the ring + check mark
 *   - `onSelectToggle` is called on shift/meta/ctrl click
 *   - When multiple cards are selected and the user drags any selected card,
 *     the parent hook handles the batch move
 */
export const DraggableDealCard = memo(function DraggableDealCard({
  deal,
  healthProfile,
  isSelected = false,
  onSelectToggle,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
  onOpenHealthProfile,
}: {
  deal: QrmRepSafeDeal;
  healthProfile: { profileId: string; score: number | null } | null;
  isSelected?: boolean;
  onSelectToggle?: (dealId: string, additive: boolean) => void;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
  onOpenHealthProfile: (profileId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, data: { deal } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    // Shift / Meta / Ctrl click = selection toggle.
    // Plain click falls through to card interactions (links, buttons).
    if (!onSelectToggle) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      onSelectToggle(deal.id, event.shiftKey);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClickCapture={handleClickCapture}
      className={cn(
        "cursor-grab active:cursor-grabbing rounded-lg transition-shadow",
        isSelected && "ring-2 ring-qep-orange ring-offset-2 ring-offset-background",
      )}
      aria-pressed={onSelectToggle ? isSelected : undefined}
    >
      <PipelineDealCard
        deal={deal}
        healthProfile={healthProfile}
        onCommitPipelineFollowUp={onCommitPipelineFollowUp}
        onSchedulePipelineRefresh={onSchedulePipelineRefresh}
        onOpenHealthProfile={onOpenHealthProfile}
      />
    </div>
  );
});
