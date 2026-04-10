import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { PipelineDealCard } from "./PipelineDealCard";
import type { QrmRepSafeDeal } from "../lib/types";

export const DraggableDealCard = memo(function DraggableDealCard({
  deal,
  healthProfile,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
  onOpenHealthProfile,
}: {
  deal: QrmRepSafeDeal;
  healthProfile: { profileId: string; score: number | null } | null;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
  onOpenHealthProfile: (profileId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { deal },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
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
