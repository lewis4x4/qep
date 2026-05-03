import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, Camera, CheckCircle2, GripVertical, Loader2, Package } from "lucide-react";
import {
  getChecklistProgress,
  getEquipmentLabel,
  getPhotoCount,
  validateIntakeStageAdvance,
  type IntakeCardRecord,
} from "../lib/intake-kanban";
import { normalizeIntakeCardRows } from "../lib/ops-row-normalizers";

const STAGES = [
  { num: 1, label: "Purchase & Logistics", color: "border-l-blue-400" },
  { num: 2, label: "Equipment Arrival", color: "border-l-cyan-400" },
  { num: 3, label: "PDI Completion", color: "border-l-amber-400" },
  { num: 4, label: "Inventory Labeling", color: "border-l-violet-400" },
  { num: 5, label: "Sales Readiness", color: "border-l-pink-400" },
  { num: 6, label: "Online Listing", color: "border-l-indigo-400" },
  { num: 7, label: "Internal Docs", color: "border-l-teal-400" },
  { num: 8, label: "Sale Ready", color: "border-l-emerald-400" },
] as const;

function IntakeStageColumn({
  stage,
  children,
  count,
}: {
  stage: (typeof STAGES)[number];
  children: React.ReactNode;
  count: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: String(stage.num),
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-[280px] shrink-0 snap-start rounded-2xl border border-border bg-muted/30 transition ${isOver ? "border-qep-orange/40 bg-qep-orange/5" : ""}`}
    >
      <header className={`border-b border-border px-4 py-3 ${stage.color} border-l-2`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{stage.label}</h2>
            <p className="text-[11px] text-muted-foreground">Stage {stage.num}</p>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {count}
          </span>
        </div>
      </header>
      <div className="min-h-[220px] space-y-3 p-3">{children}</div>
    </div>
  );
}

function IntakeCardBody({ item }: { item: IntakeCardRecord }) {
  const checklist = getChecklistProgress(item);
  const photoCount = getPhotoCount(item);

  return (
    <Card className="rounded-xl border-white/10 bg-black/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{item.stock_number || "No Stock #"}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{getEquipmentLabel(item)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">{item.ship_to_branch || "Branch not set"}</p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] p-1.5 text-muted-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" />
            Checklist
          </div>
          <p className="mt-1 font-medium text-foreground">
            {checklist.total > 0 ? `${checklist.completed}/${checklist.total}` : "No PDI yet"}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Camera className="h-3 w-3" />
            Photos
          </div>
          <p className="mt-1 font-medium text-foreground">{photoCount}</p>
        </div>
      </div>

      {item.current_stage === 3 && !item.pdi_completed && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          PDI must be signed off before this unit can move forward.
        </div>
      )}
    </Card>
  );
}

function DraggableIntakeCard({ item }: { item: IntakeCardRecord }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: item,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={isDragging ? "opacity-40" : ""}
      {...attributes}
      {...listeners}
    >
      <IntakeCardBody item={item} />
    </div>
  );
}

export function IntakeKanbanPage() {
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const { data: items = [], isLoading, isError, error } = useQuery<IntakeCardRecord[]>({
    queryKey: ["ops", "intake"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_intake")
        .select("id, current_stage, stock_number, ship_to_branch, arrival_photos, pdi_checklist, pdi_completed, photo_ready, listing_photos, crm_equipment(name)")
        .order("current_stage")
        .order("created_at");
      if (error) throw error;
      return normalizeIntakeCardRows(data);
    },
    staleTime: 15_000,
  });

  const stageMutation = useMutation({
    mutationFn: async ({ id, newStage }: { id: string; newStage: number }) => {
      const { error } = await supabase
        .from("equipment_intake")
        .update({ current_stage: newStage })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setStageError(null);
      queryClient.invalidateQueries({ queryKey: ["ops", "intake"] });
    },
  });

  const itemsByStage = useMemo(() => {
    const grouped = new Map<number, IntakeCardRecord[]>();
    for (const stage of STAGES) grouped.set(stage.num, []);
    for (const item of items) {
      grouped.get(item.current_stage)?.push(item);
    }
    return grouped;
  }, [items]);

  const activeItem = activeId ? items.find((item) => item.id === activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setStageError(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);

    const targetStage = Number(event.over?.id);
    if (!event.over || Number.isNaN(targetStage)) return;

    const intakeItem = items.find((item) => item.id === String(event.active.id));
    if (!intakeItem || intakeItem.current_stage === targetStage) return;

    const gate = validateIntakeStageAdvance(intakeItem, targetStage);
    if (!gate.allowed) {
      setStageError(gate.reason);
      return;
    }

    stageMutation.mutate({ id: intakeItem.id, newStage: targetStage });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-foreground">Equipment Intake Pipeline</h1>
          <p className="text-sm text-muted-foreground">Loading intake board…</p>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.slice(0, 4).map((stage) => (
            <Card key={stage.num} className="h-56 w-[280px] shrink-0 animate-pulse bg-muted/30" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-[960px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <Card className="border-red-500/20 bg-red-500/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">Equipment intake unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "The intake pipeline could not be loaded."}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[960px] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <Package className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">No intake units in flight</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The intake board will populate when new equipment is staged for purchase-to-sale-ready processing.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Equipment Intake Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            8-stage intake Kanban from purchase through sale-ready, with drag/drop progression and readiness gates.
          </p>
        </div>
        {stageMutation.isPending && (
          <div className="inline-flex items-center gap-2 rounded-full border border-qep-orange/20 bg-qep-orange/10 px-3 py-1.5 text-[11px] text-qep-orange">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating stage…
          </div>
        )}
      </div>

      {stageError && (
        <Card className="mb-4 border-amber-500/20 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{stageError}</span>
          </div>
        </Card>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max snap-x snap-mandatory gap-4">
            {STAGES.map((stage) => {
              const stageItems = itemsByStage.get(stage.num) ?? [];
              return (
                <IntakeStageColumn key={stage.num} stage={stage} count={stageItems.length}>
                  {stageItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-10 text-center text-[11px] text-muted-foreground">
                      Drop a unit here
                    </div>
                  ) : (
                    stageItems.map((item) => <DraggableIntakeCard key={item.id} item={item} />)
                  )}
                </IntakeStageColumn>
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {activeItem ? <IntakeCardBody item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>

      <div className="mt-4 flex items-center justify-end">
        <Button asChild variant="outline" size="sm">
          <a href="/ops/pdi">Open PDI tap-through</a>
        </Button>
      </div>
    </div>
  );
}
