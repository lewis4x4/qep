import { DndContext, closestCenter } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { DraggableDealCard } from "./DraggableDealCard";
import { DroppableStageColumn } from "./DroppableStageColumn";
import type { QrmDealStage, QrmRepSafeDeal } from "../lib/types";
import { formatMoney } from "../lib/pipeline-utils";

export interface PipelineSwimLaneColumn {
  stageId: string;
  stageName: string;
  deals: QrmRepSafeDeal[];
  amount: number;
}

interface PipelineSwimLanesBoardProps {
  stages: QrmDealStage[] | undefined;
  stageColumns: PipelineSwimLaneColumn[];
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => Promise<void>;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
}

const SWIM_LANES: Array<{ label: string; range: [number, number]; color: string }> = [
  { label: "Pre-Sale Pipeline", range: [1, 12], color: "border-blue-500/30" },
  { label: "Close Process", range: [13, 16], color: "border-orange-500/30" },
  { label: "Post-Sale", range: [17, 21], color: "border-emerald-500/30" },
];

export function PipelineSwimLanesBoard({
  stages,
  stageColumns,
  onDragStart,
  onDragEnd,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
}: PipelineSwimLanesBoardProps) {
  return (
    <DndContext collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        {SWIM_LANES.map((lane) => {
          const laneColumns = stageColumns.filter((col) => {
            const stage = (stages ?? []).find((s) => s.id === col.stageId);
            const order = stage?.sortOrder ?? 0;
            return order >= lane.range[0] && order <= lane.range[1];
          });
          if (laneColumns.length === 0) return null;
          const laneDeals = laneColumns.reduce((sum, c) => sum + c.deals.length, 0);
          const laneAmount = laneColumns.reduce((sum, c) => sum + c.amount, 0);
          return (
            <Card key={lane.label} className={`overflow-hidden border-l-2 ${lane.color}`}>
              <header className="flex items-center justify-between border-b border-border px-4 py-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{lane.label}</h2>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{laneDeals} deals</span>
                  <span>{formatMoney(laneAmount)}</span>
                </div>
              </header>
              <div className="overflow-x-auto" aria-label={`${lane.label} deals board`}>
                <div className="flex min-w-max gap-3 p-3">
                  {laneColumns.map((column) => (
                    <section
                      key={column.stageId}
                      className="w-[280px] shrink-0 rounded-xl border border-border bg-muted/30"
                    >
                      <header className="border-b border-border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{column.stageName}</h3>
                          <span className="rounded-full border border-white/12 bg-gradient-to-b from-white/[0.1] to-white/[0.02] px-2 py-0.5 text-xs text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-md dark:border-white/10 dark:from-white/[0.07] dark:to-white/[0.02]">
                            {column.deals.length}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{formatMoney(column.amount)}</p>
                      </header>

                      <DroppableStageColumn stageId={column.stageId}>
                        {column.deals.length === 0 && (
                          <div className="rounded-lg border border-dashed border-input bg-card px-3 py-4 text-center text-xs text-muted-foreground">
                            No deals
                          </div>
                        )}

                        {column.deals.map((deal) => (
                          <DraggableDealCard
                            key={deal.id}
                            deal={deal}
                            onCommitPipelineFollowUp={onCommitPipelineFollowUp}
                            onSchedulePipelineRefresh={onSchedulePipelineRefresh}
                          />
                        ))}
                      </DroppableStageColumn>
                    </section>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </DndContext>
  );
}
