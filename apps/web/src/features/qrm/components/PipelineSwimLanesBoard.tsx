import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
  healthProfileByCompanyId: Map<string, { profileId: string; score: number | null }>;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => Promise<void>;
  onCommitPipelineFollowUp: (dealId: string, nextFollowUpAt: string | null) => void;
  onSchedulePipelineRefresh: (dealId: string) => void;
  onOpenHealthProfile: (profileId: string) => void;
  showAnalytics?: boolean;
}

const SWIM_LANES: Array<{ label: string; range: [number, number]; color: string }> = [
  { label: "Pre-Sale Pipeline", range: [1, 12], color: "border-blue-500/30" },
  { label: "Close Process", range: [13, 16], color: "border-orange-500/30" },
  { label: "Post-Sale", range: [17, 21], color: "border-emerald-500/30" },
];

const DAY_MS = 86_400_000;

function avgDaysInStage(deals: QrmRepSafeDeal[]): number | null {
  const now = Date.now();
  const days = deals
    .map((d) => {
      const entered = d.lastActivityAt ? Date.parse(d.lastActivityAt) : Date.parse(d.createdAt);
      return Number.isFinite(entered) ? (now - entered) / DAY_MS : null;
    })
    .filter((d): d is number => d !== null);
  if (days.length === 0) return null;
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

function sortByPosition(deals: QrmRepSafeDeal[]): QrmRepSafeDeal[] {
  return [...deals].sort((a, b) => {
    const posA = (a as unknown as Record<string, unknown>).sortPosition as number | null ?? Infinity;
    const posB = (b as unknown as Record<string, unknown>).sortPosition as number | null ?? Infinity;
    if (posA !== posB) return posA - posB;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function PipelineSwimLanesBoard({
  stages,
  stageColumns,
  healthProfileByCompanyId,
  onDragStart,
  onDragEnd,
  onCommitPipelineFollowUp,
  onSchedulePipelineRefresh,
  onOpenHealthProfile,
  showAnalytics = false,
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
                  {laneColumns.map((column) => {
                    const sortedDeals = sortByPosition(column.deals);
                    const dealIds = sortedDeals.map((d) => d.id);
                    const avgDays = showAnalytics ? avgDaysInStage(sortedDeals) : null;
                    const isOverThreshold = avgDays !== null && avgDays > 14;
                    const isNearThreshold = avgDays !== null && avgDays > 7;

                    return (
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
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{formatMoney(column.amount)}</span>
                            {showAnalytics && avgDays !== null && (
                              <span className={cn(
                                "text-[10px] tabular-nums",
                                isOverThreshold ? "text-rose-400" : isNearThreshold ? "text-amber-400" : "text-emerald-400",
                              )}>
                                ~{avgDays}d avg
                              </span>
                            )}
                          </div>
                        </header>

                        <DroppableStageColumn stageId={column.stageId}>
                          <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
                            {sortedDeals.length === 0 && (
                              <div className="rounded-lg border border-dashed border-input bg-card px-3 py-4 text-center text-xs text-muted-foreground">
                                No deals
                              </div>
                            )}

                            {sortedDeals.map((deal) => (
                              <DraggableDealCard
                                key={deal.id}
                                deal={deal}
                                healthProfile={deal.companyId ? healthProfileByCompanyId.get(deal.companyId) ?? null : null}
                                onCommitPipelineFollowUp={onCommitPipelineFollowUp}
                                onSchedulePipelineRefresh={onSchedulePipelineRefresh}
                                onOpenHealthProfile={onOpenHealthProfile}
                              />
                            ))}
                          </SortableContext>
                        </DroppableStageColumn>
                      </section>
                    );
                  })}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </DndContext>
  );
}
