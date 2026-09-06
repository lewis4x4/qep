import { GripVertical } from "lucide-react";
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
    setActivatorNodeRef,
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
      onClickCapture={handleClickCapture}
      className={cn(
        "rounded-lg transition-shadow",
        isSelected && "ring-2 ring-qep-orange ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
          aria-label={`Move ${deal.name}`} className="inline-flex min-h-9 touch-none cursor-grab items-center gap-1 rounded px-2 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing">
          <GripVertical className="h-4 w-4" aria-hidden /> Move
        </button>
        {onSelectToggle && <button type="button" aria-pressed={isSelected} aria-label={`Select ${deal.name}`} className="min-h-9 rounded px-2 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={(event) => { event.stopPropagation(); onSelectToggle(deal.id, false); }}>{isSelected ? "Selected" : "Select"}</button>}
      </div>
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
