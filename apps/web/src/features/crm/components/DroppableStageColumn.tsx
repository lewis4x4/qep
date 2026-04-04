import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";

export const DroppableStageColumn = memo(function DroppableStageColumn({
  stageId,
  children,
}: {
  stageId: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stageId });

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 p-2 min-h-[60px] rounded-b-xl transition-colors ${
        isOver ? "bg-primary/5 ring-1 ring-primary/30" : ""
      }`}
    >
      {children}
    </div>
  );
});
