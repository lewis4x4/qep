import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { MapPin, Clock, Target } from "lucide-react";

interface PredictiveVisitListProps {
  userId: string;
}

export function PredictiveVisitList({ userId }: PredictiveVisitListProps) {
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["dge", "visit-list", userId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("predictive_visit_lists")
        .select("*")
        .eq("rep_id", userId)
        .eq("list_date", today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Card className="animate-pulse p-4"><div className="h-20 rounded bg-muted" /></Card>;
  }

  const recommendations = data?.recommendations ?? [];

  if (recommendations.length === 0) {
    return (
      <Card className="border-dashed p-4">
        <p className="text-sm text-muted-foreground">No predictive visit list generated for today. Check back after the morning briefing.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Target className="h-4 w-4 text-qep-orange" />
        <h3 className="text-sm font-semibold text-foreground">Today's Visit List</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {data?.visits_completed ?? 0}/{data?.visits_total ?? 10}
        </span>
      </div>
      <div className="space-y-2">
        {recommendations.map((rec: any, index: number) => (
          <div key={index} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-qep-orange/10 text-xs font-bold text-qep-orange">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{rec.company_name || rec.contact_name || "Customer"}</p>
              <p className="text-xs text-muted-foreground">{rec.reason}</p>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                {rec.last_contact_days != null && (
                  <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" /> {rec.last_contact_days}d ago</span>
                )}
                {rec.distance_km != null && (
                  <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" /> {rec.distance_km.toFixed(1)}km</span>
                )}
                {rec.priority_score != null && (
                  <span>Priority: {rec.priority_score}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
