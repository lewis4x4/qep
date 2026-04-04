import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

interface CadenceTimelineProps {
  dealId: string;
}

interface Touchpoint {
  id: string;
  touchpoint_type: string;
  scheduled_date: string;
  purpose: string;
  suggested_message: string | null;
  value_type: string | null;
  status: "pending" | "completed" | "skipped" | "overdue";
  completed_at: string | null;
  delivery_method: string | null;
}

interface Cadence {
  id: string;
  cadence_type: "sales" | "post_sale";
  status: string;
  started_at: string;
  follow_up_touchpoints: Touchpoint[];
}

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  pending: { dot: "bg-blue-400", text: "text-blue-400" },
  completed: { dot: "bg-emerald-400", text: "text-emerald-400" },
  skipped: { dot: "bg-muted-foreground", text: "text-muted-foreground line-through" },
  overdue: { dot: "bg-red-400 animate-pulse", text: "text-red-400 font-semibold" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export function CadenceTimeline({ dealId }: CadenceTimelineProps) {
  const { data: cadences, isLoading, isError } = useQuery({
    queryKey: ["crm", "cadences", dealId],
    queryFn: async () => {
      // Tables added in migration 069 — not yet in generated types
      const { data, error } = await (supabase as any)
        .from("follow_up_cadences")
        .select(`
          id, cadence_type, status, started_at,
          follow_up_touchpoints(
            id, touchpoint_type, scheduled_date, purpose,
            suggested_message, value_type, status, completed_at, delivery_method
          )
        `)
        .eq("deal_id", dealId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Cadence[];
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="animate-pulse p-4">
        <div className="h-4 w-32 rounded bg-muted" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-red-500/20 p-4">
        <p className="text-sm text-red-400">Unable to load follow-up cadence.</p>
      </Card>
    );
  }

  if (!cadences || cadences.length === 0) {
    return (
      <Card className="border-dashed p-4">
        <p className="text-sm text-muted-foreground">No follow-up cadence active. Cadence auto-starts when a quote is sent.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {cadences.map((cadence) => (
        <Card key={cadence.id} className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              {cadence.cadence_type === "sales" ? "Sales Cadence" : "Post-Sale Cadence"}
            </h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              cadence.status === "active"
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}>
              {cadence.status}
            </span>
          </div>

          {/* Timeline */}
          <div className="relative mt-3 ml-3 border-l border-border pl-4">
            {(cadence.follow_up_touchpoints || [])
              .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())
              .map((tp) => {
                const styles = STATUS_STYLES[tp.status] || STATUS_STYLES.pending;
                const days = daysUntil(tp.scheduled_date);
                const daysLabel =
                  tp.status === "completed" ? "Done" :
                  days < 0 ? `${Math.abs(days)}d overdue` :
                  days === 0 ? "Today" :
                  days === 1 ? "Tomorrow" :
                  `${days}d`;

                return (
                  <div key={tp.id} className="relative -ml-[21px] mb-4 last:mb-0">
                    {/* Timeline dot */}
                    <div className={`absolute top-1.5 h-2.5 w-2.5 rounded-full ${styles.dot}`} />

                    <div className="ml-5">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${styles.text}`}>
                          {tp.touchpoint_type.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDate(tp.scheduled_date)}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          tp.status === "overdue" ? "bg-red-500/10 text-red-400 font-semibold" :
                          tp.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {daysLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{tp.purpose}</p>
                      {tp.suggested_message && (
                        <div className="mt-1 rounded bg-muted/30 px-2 py-1.5">
                          <p className="text-[11px] italic text-foreground/80">{tp.suggested_message}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      ))}
    </div>
  );
}
