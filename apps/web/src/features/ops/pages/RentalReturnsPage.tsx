import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { RotateCcw, CheckCircle, AlertTriangle } from "lucide-react";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  inspection_pending: { label: "Inspection Pending", color: "bg-amber-500/10 text-amber-400" },
  decision_pending: { label: "Decision Pending", color: "bg-blue-500/10 text-blue-400" },
  clean_return: { label: "Clean Return", color: "bg-emerald-500/10 text-emerald-400" },
  damage_assessment: { label: "Damage Assessment", color: "bg-red-500/10 text-red-400" },
  work_order_open: { label: "Work Order Open", color: "bg-violet-500/10 text-violet-400" },
  refund_processing: { label: "Refund Processing", color: "bg-cyan-500/10 text-cyan-400" },
  completed: { label: "Completed", color: "bg-muted text-muted-foreground" },
};

export function RentalReturnsPage() {
  const { data: returns, isLoading } = useQuery({
    queryKey: ["ops", "rental-returns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rental_returns")
        .select("*")
        .neq("status", "completed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
  });

  if (isLoading) {
    return <div className="space-y-4 p-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground">Rental Returns</h1>
        <p className="text-sm text-muted-foreground">Branching workflow: inspection → decision → clean path or damage path</p>
      </div>

      <div className="space-y-3">
        {(returns ?? []).length === 0 ? (
          <Card className="p-6 text-center"><p className="text-sm text-muted-foreground">No active rental returns.</p></Card>
        ) : (
          (returns ?? []).map((ret: any) => {
            const statusInfo = STATUS_LABELS[ret.status] || STATUS_LABELS.inspection_pending;
            const isClean = ret.has_charges === false;
            const isDamaged = ret.has_charges === true;

            return (
              <Card key={ret.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    <div className="mt-2 flex items-center gap-2">
                      {isClean && <CheckCircle className="h-4 w-4 text-emerald-400" />}
                      {isDamaged && <AlertTriangle className="h-4 w-4 text-red-400" />}
                      <span className="text-sm font-medium text-foreground">
                        {isClean ? "Clean Return" : isDamaged ? "Damage Found" : "Awaiting Inspection"}
                      </span>
                    </div>
                    {ret.damage_description && (
                      <p className="mt-1 text-xs text-red-300">{ret.damage_description}</p>
                    )}
                    {ret.charge_amount && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Charges: ${ret.charge_amount?.toLocaleString()} | Deposit: ${ret.deposit_amount?.toLocaleString()}
                        {ret.deposit_covers_charges === false && ret.balance_due && (
                          <span className="text-red-400"> | Balance due: ${ret.balance_due?.toLocaleString()}</span>
                        )}
                      </p>
                    )}
                    {ret.refund_status && ret.refund_status !== "completed" && (
                      <p className="mt-1 text-xs text-cyan-400">
                        <RotateCcw className="inline h-3 w-3 mr-1" />
                        Refund: {ret.refund_status} ({ret.refund_check_turnaround})
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
