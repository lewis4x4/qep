import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

const STAGES = [
  { num: 1, label: "Purchase & Logistics", color: "border-l-blue-400" },
  { num: 2, label: "Equipment Arrival", color: "border-l-cyan-400" },
  { num: 3, label: "PDI Completion", color: "border-l-amber-400" },
  { num: 4, label: "Inventory Labeling", color: "border-l-violet-400" },
  { num: 5, label: "Sales Readiness", color: "border-l-pink-400" },
  { num: 6, label: "Online Listing", color: "border-l-indigo-400" },
  { num: 7, label: "Internal Docs", color: "border-l-teal-400" },
  { num: 8, label: "Sale Ready", color: "border-l-emerald-400" },
];

export function IntakeKanbanPage() {
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: ["ops", "intake"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_intake")
        .select("*")
        .order("current_stage")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
  });

  const advanceMutation = useMutation({
    mutationFn: async ({ id, newStage }: { id: string; newStage: number }) => {
      const { error } = await supabase
        .from("equipment_intake")
        .update({ current_stage: newStage })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ops", "intake"] }),
  });

  if (isLoading) {
    return <div className="space-y-4 p-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-24 animate-pulse" />)}</div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Equipment Intake Pipeline</h1>
        <p className="text-sm text-muted-foreground">8-stage Kanban: purchase to sale-ready</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-3">
          {STAGES.map((stage) => {
            const stageItems = (items ?? []).filter((i: any) => i.current_stage === stage.num);
            return (
              <div key={stage.num} className={`w-[220px] shrink-0 rounded-xl border border-border ${stage.color} border-l-2 bg-muted/30`}>
                <header className="border-b border-border px-3 py-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground">{stage.label}</h3>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{stageItems.length}</span>
                  </div>
                </header>
                <div className="min-h-[100px] space-y-2 p-2">
                  {stageItems.map((item: any) => (
                    <Card key={item.id} className="p-2.5">
                      <p className="text-xs font-semibold text-foreground">{item.stock_number || "No Stock #"}</p>
                      <p className="text-[10px] text-muted-foreground">{item.ship_to_branch || "No branch"}</p>
                      {stage.num < 8 && (
                        <button
                          onClick={() => advanceMutation.mutate({ id: item.id, newStage: stage.num + 1 })}
                          className="mt-2 w-full rounded bg-qep-orange/10 px-2 py-1 text-[10px] font-medium text-qep-orange hover:bg-qep-orange/20 transition"
                          disabled={advanceMutation.isPending}
                        >
                          Advance →
                        </button>
                      )}
                    </Card>
                  ))}
                  {stageItems.length === 0 && (
                    <div className="rounded border border-dashed border-input px-2 py-4 text-center text-[10px] text-muted-foreground">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
