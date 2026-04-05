import { useState, useCallback, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SERVICE_STAGES, STAGE_LABELS } from "../lib/constants";
import type { ServiceStage } from "../lib/constants";
import type { ServiceJobWithRelations } from "../lib/types";
import { ServiceJobCard } from "./ServiceJobCard";
import { useTransitionServiceJob } from "../hooks/useServiceJobMutation";
import { GripVertical } from "lucide-react";

interface Props {
  jobs: ServiceJobWithRelations[];
  onJobClick: (jobId: string) => void;
}

const VISIBLE_STAGES = SERVICE_STAGES.filter((s) => s !== "paid_closed");

function columnShellClass(stage: ServiceStage): string {
  const base =
    "rounded-t-xl border-x border-t border-border/60 bg-gradient-to-b from-background to-muted/30";
  const accent: Partial<Record<ServiceStage, string>> = {
    request_received: "border-l-slate-400/80",
    triaging: "border-l-blue-500/70",
    diagnosis_selected: "border-l-indigo-500/70",
    quote_drafted: "border-l-purple-500/70",
    quote_sent: "border-l-violet-500/70",
    approved: "border-l-emerald-500/70",
    parts_pending: "border-l-amber-500/70",
    parts_staged: "border-l-lime-600/70",
    haul_scheduled: "border-l-cyan-500/70",
    scheduled: "border-l-teal-500/70",
    in_progress: "border-l-sky-500/70",
    blocked_waiting: "border-l-red-500/70",
    quality_check: "border-l-orange-500/70",
    ready_for_pickup: "border-l-emerald-600/70",
    invoice_ready: "border-l-yellow-500/70",
    invoiced: "border-l-stone-500/70",
  };
  return `${base} ${accent[stage] ?? "border-l-muted-foreground/40"}`;
}

function resolveOverToStage(
  overId: string | undefined,
  jobList: ServiceJobWithRelations[],
): ServiceStage | null {
  if (!overId) return null;
  if (VISIBLE_STAGES.some((s) => s === overId)) return overId as ServiceStage;
  const j = jobList.find((x) => x.id === overId);
  return j ? (j.current_stage as ServiceStage) : null;
}

function DroppableColumn({
  stage,
  count,
  children,
}: {
  stage: ServiceStage;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[min(20rem,85vw)] shrink-0 flex-col rounded-xl shadow-sm transition-shadow duration-200 ${
        isOver ? "ring-2 ring-primary/40 shadow-md" : "ring-1 ring-border/40"
      }`}
    >
      <div className={`px-3 py-2.5 ${columnShellClass(stage)}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-tight text-foreground">
            {STAGE_LABELS[stage]}
          </span>
          <span className="tabular-nums rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {count}
          </span>
        </div>
      </div>
      <div
        className={`flex min-h-[10rem] flex-1 flex-col gap-2 rounded-b-xl border border-t-0 border-border/50 bg-muted/20 p-2 dark:bg-muted/10 ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        {children}
        {count === 0 && (
          <p className="py-8 text-center text-[11px] text-muted-foreground/70">Drop jobs here</p>
        )}
      </div>
    </div>
  );
}

function DraggableJobCard({
  job,
  onCardClick,
}: {
  job: ServiceJobWithRelations;
  onCardClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} className={`relative ${isDragging ? "opacity-30" : ""}`}>
      <div className="flex gap-0 rounded-xl border border-border/60 bg-card shadow-sm transition hover:border-primary/30 hover:shadow-md dark:border-border/80">
        <button
          type="button"
          className="flex shrink-0 cursor-grab touch-none items-center justify-center rounded-l-xl border-r border-border/40 bg-muted/30 px-1 text-muted-foreground hover:bg-muted/60 active:cursor-grabbing"
          aria-label="Drag to change stage"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 py-0.5 pr-1">
          <ServiceJobCard job={job} onClick={onCardClick} variant="kanban" />
        </div>
      </div>
    </div>
  );
}

export function ServiceKanbanBoard({ jobs, onJobClick }: Props) {
  const transition = useTransitionServiceJob();
  const [activeJob, setActiveJob] = useState<ServiceJobWithRelations | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const jobsByStage = VISIBLE_STAGES.reduce<Record<string, ServiceJobWithRelations[]>>(
    (acc, stage) => {
      acc[stage] = jobs.filter((j) => j.current_stage === stage);
      return acc;
    },
    {},
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      const job = jobs.find((j) => j.id === id);
      setActiveJob(job ?? null);
    },
    [jobs],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveJob(null);
      const jobId = String(event.active.id);
      const overRaw = event.over?.id ? String(event.over.id) : undefined;
      const targetStage = resolveOverToStage(overRaw, jobs);
      if (!targetStage) return;

      const job = jobs.find((j) => j.id === jobId);
      if (!job || job.current_stage === targetStage) return;

      transition.mutate({ id: jobId, toStage: targetStage });
    },
    [jobs, transition],
  );

  const handleDragCancel = useCallback(() => {
    setActiveJob(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex min-h-[calc(100vh-14rem)] gap-3 overflow-x-auto overflow-y-hidden pb-4 pt-1 [scrollbar-gutter:stable]">
        {VISIBLE_STAGES.map((stage) => {
          const stageJobs = jobsByStage[stage] ?? [];
          return (
            <DroppableColumn key={stage} stage={stage as ServiceStage} count={stageJobs.length}>
              {stageJobs.map((job) => (
                <DraggableJobCard key={job.id} job={job} onCardClick={() => onJobClick(job.id)} />
              ))}
            </DroppableColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
        {activeJob ? (
          <div className="w-[min(18rem,80vw)] rotate-1 cursor-grabbing rounded-xl border border-primary/30 bg-card p-3 shadow-xl ring-2 ring-primary/20">
            <ServiceJobCard job={activeJob} variant="kanban" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
