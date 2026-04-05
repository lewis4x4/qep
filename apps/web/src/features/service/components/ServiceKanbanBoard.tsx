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
import { GripVertical, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  jobs: ServiceJobWithRelations[];
  onJobClick: (jobId: string) => void;
}

const VISIBLE_STAGES = SERVICE_STAGES.filter((s) => s !== "paid_closed");

const STAGE_ACCENT: Partial<Record<ServiceStage, { dot: string; glow: string; border: string }>> = {
  request_received: { dot: "bg-slate-400", glow: "shadow-slate-400/20", border: "border-l-slate-400/60" },
  triaging: { dot: "bg-blue-400", glow: "shadow-blue-400/20", border: "border-l-blue-400/60" },
  diagnosis_selected: { dot: "bg-indigo-400", glow: "shadow-indigo-400/20", border: "border-l-indigo-400/60" },
  quote_drafted: { dot: "bg-purple-400", glow: "shadow-purple-400/20", border: "border-l-purple-400/60" },
  quote_sent: { dot: "bg-violet-400", glow: "shadow-violet-400/20", border: "border-l-violet-400/60" },
  approved: { dot: "bg-emerald-400", glow: "shadow-emerald-400/20", border: "border-l-emerald-400/60" },
  parts_pending: { dot: "bg-amber-400", glow: "shadow-amber-400/20", border: "border-l-amber-400/60" },
  parts_staged: { dot: "bg-lime-400", glow: "shadow-lime-400/20", border: "border-l-lime-400/60" },
  haul_scheduled: { dot: "bg-cyan-400", glow: "shadow-cyan-400/20", border: "border-l-cyan-400/60" },
  scheduled: { dot: "bg-teal-400", glow: "shadow-teal-400/20", border: "border-l-teal-400/60" },
  in_progress: { dot: "bg-sky-400", glow: "shadow-sky-400/20", border: "border-l-sky-400/60" },
  blocked_waiting: { dot: "bg-red-400", glow: "shadow-red-400/20", border: "border-l-red-400/60" },
  quality_check: { dot: "bg-orange-400", glow: "shadow-orange-400/20", border: "border-l-orange-400/60" },
  ready_for_pickup: { dot: "bg-emerald-500", glow: "shadow-emerald-500/20", border: "border-l-emerald-500/60" },
  invoice_ready: { dot: "bg-yellow-400", glow: "shadow-yellow-400/20", border: "border-l-yellow-400/60" },
  invoiced: { dot: "bg-stone-400", glow: "shadow-stone-400/20", border: "border-l-stone-400/60" },
};

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
  const accent = STAGE_ACCENT[stage];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[min(18rem,85vw)] shrink-0 flex-col rounded-2xl transition-all duration-200",
        "border border-border/30 dark:border-white/[0.06]",
        "bg-card/50 dark:bg-white/[0.02]",
        isOver
          ? "ring-2 ring-primary/30 shadow-lg scale-[1.01] border-primary/20"
          : "shadow-sm hover:shadow-md",
      )}
    >
      {/* Column header */}
      <div className={cn(
        "flex items-center gap-2.5 rounded-t-2xl border-l-[3px] px-3.5 py-3",
        "bg-gradient-to-r from-muted/30 to-transparent dark:from-white/[0.03] dark:to-transparent",
        accent?.border ?? "border-l-muted-foreground/40",
      )}>
        <span className={cn(
          "h-2 w-2 shrink-0 rounded-full shadow-[0_0_6px]",
          accent?.dot ?? "bg-muted-foreground",
          accent?.glow ?? "",
        )} />
        <span className="flex-1 text-[13px] font-semibold tracking-tight text-foreground">
          {STAGE_LABELS[stage]}
        </span>
        <span className={cn(
          "tabular-nums rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
          count > 0
            ? "bg-foreground/[0.08] text-foreground dark:bg-white/[0.08]"
            : "text-muted-foreground/60"
        )}>
          {count}
        </span>
      </div>

      {/* Column body */}
      <div
        className={cn(
          "flex min-h-[12rem] flex-1 flex-col gap-2 rounded-b-2xl p-2 transition-colors duration-200",
          isOver
            ? "bg-primary/[0.04] dark:bg-primary/[0.06]"
            : "bg-transparent"
        )}
      >
        {children}
        {count === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6">
            <Inbox className="h-5 w-5 text-muted-foreground/30" />
            <p className="text-[11px] text-muted-foreground/50">Drop jobs here</p>
          </div>
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
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative transition-opacity duration-150",
        isDragging && "opacity-30 scale-95"
      )}
    >
      <div className={cn(
        "group flex gap-0 rounded-xl border bg-card shadow-sm transition-all duration-150",
        "border-border/40 dark:border-white/[0.06]",
        "hover:border-primary/20 hover:shadow-md hover:-translate-y-px",
      )}>
        <button
          type="button"
          className="flex shrink-0 cursor-grab touch-none items-center justify-center rounded-l-xl border-r border-border/30 bg-muted/20 px-1.5 text-muted-foreground/50 transition-colors hover:bg-muted/40 hover:text-muted-foreground active:cursor-grabbing dark:border-white/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.05]"
          aria-label="Drag to change stage"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-3.5 w-3.5" />
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
      <div className="flex min-h-[calc(100vh-16rem)] gap-3 overflow-x-auto overflow-y-hidden pb-6 pt-1 [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]">
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
          <div className="w-[min(17rem,80vw)] rotate-[1.5deg] cursor-grabbing rounded-xl border border-primary/30 bg-card p-3 shadow-2xl shadow-primary/10 ring-2 ring-primary/20 dark:shadow-primary/20">
            <ServiceJobCard job={activeJob} variant="kanban" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
