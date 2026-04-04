import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

interface DemoRequestCardProps {
  dealId: string;
}

interface Demo {
  id: string;
  status: string;
  equipment_category: string | null;
  max_hours: number;
  starting_hours: number | null;
  ending_hours: number | null;
  hours_used: number | null;
  total_demo_cost: number | null;
  scheduled_date: string | null;
  followup_due_at: string | null;
  followup_completed: boolean;
  customer_decision: string | null;
  needs_assessment_complete: boolean;
  quote_presented: boolean;
  buying_intent_confirmed: boolean;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-amber-500/10 text-amber-400",
  approved: "bg-blue-500/10 text-blue-400",
  scheduled: "bg-blue-500/10 text-blue-400",
  in_progress: "bg-violet-500/10 text-violet-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  denied: "bg-red-500/10 text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

export function DemoRequestCard({ dealId }: DemoRequestCardProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<"construction" | "forestry">("construction");

  const { data: demos, isLoading } = useQuery({
    queryKey: ["crm", "demos", dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demos")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Demo[];
    },
    staleTime: 30_000,
  });

  const [mutationError, setMutationError] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/demo-manager`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deal_id: dealId,
          equipment_category: category,
          buying_intent_confirmed: true,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errData.error || `Request failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ["crm", "demos", dealId] });
      setShowForm(false);
    },
    onError: (err: Error) => {
      setMutationError(err.message);
    },
  });

  if (isLoading) {
    return <Card className="animate-pulse p-4"><div className="h-4 w-32 rounded bg-muted" /></Card>;
  }

  const activeDemo = demos?.find((d) => !["completed", "cancelled", "denied"].includes(d.status));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Equipment Demo</h3>
        {!activeDemo && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            Request Demo
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <div>
            <label className="text-xs text-muted-foreground">Equipment Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as "construction" | "forestry")}
              className="mt-1 w-full rounded border border-input bg-card px-2 py-1.5 text-sm"
            >
              <option value="construction">Construction (10hr max)</option>
              <option value="forestry">Forestry (4hr max)</option>
            </select>
          </div>
          {mutationError && (
            <p className="text-xs text-red-400">{mutationError}</p>
          )}
          <Button
            size="sm"
            onClick={() => requestMutation.mutate()}
            disabled={requestMutation.isPending}
          >
            {requestMutation.isPending ? "Submitting..." : "Submit Request"}
          </Button>
        </div>
      )}

      {demos && demos.length > 0 && (
        <div className="mt-3 space-y-2">
          {demos.map((demo) => (
            <div key={demo.id} className="rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[demo.status] || ""}`}>
                  {demo.status.replace(/_/g, " ")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {demo.equipment_category} • {demo.max_hours}hr max
                </span>
              </div>
              {demo.hours_used !== null && (
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Hours used</span>
                    <span className={demo.hours_used >= demo.max_hours ? "text-red-400 font-bold" : ""}>
                      {demo.hours_used.toFixed(1)} / {demo.max_hours}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        demo.hours_used >= demo.max_hours ? "bg-red-500" :
                        demo.hours_used >= demo.max_hours * 0.8 ? "bg-amber-500" :
                        "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, (demo.hours_used / demo.max_hours) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {demo.total_demo_cost !== null && demo.total_demo_cost > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Demo cost: ${demo.total_demo_cost.toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {(!demos || demos.length === 0) && !showForm && (
        <p className="mt-2 text-xs text-muted-foreground">No demos scheduled. Request one after quote presentation.</p>
      )}
    </Card>
  );
}
