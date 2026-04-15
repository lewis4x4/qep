import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export const DroppableStageColumn = memo(function DroppableStageColumn({
  stageId,
  isGateRejected = false,
  children,
}: {
  stageId: string;
  /** When true, a current drag would be rejected by stage gates. Paints red. */
  isGateRejected?: boolean;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stageId });

  // Gate rejection takes visual precedence over the normal drop highlight.
  const showReject = isOver && isGateRejected;
  const showAccept = isOver && !isGateRejected;

  return (
    <div
      ref={setNodeRef}
      aria-invalid={showReject ? "true" : undefined}
      className={cn(
        "space-y-2 p-2 min-h-[60px] rounded-b-xl transition-colors",
        showAccept && "bg-primary/5 ring-1 ring-primary/30",
        showReject && "bg-rose-500/10 ring-1 ring-rose-500/60",
      )}
    >
      {children}
    </div>
  );
});
