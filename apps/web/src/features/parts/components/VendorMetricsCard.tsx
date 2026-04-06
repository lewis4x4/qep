import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";

const RESPONSIVENESS_THRESHOLD = 3;

export function VendorMetricsCard() {
  const vendorsQ = useQuery({
    queryKey: ["vendor-metrics-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_profiles")
        .select("id, name, avg_lead_time_hours, responsiveness_score");
      if (error) throw error;
      const rows = data ?? [];
      const withLead = rows.filter((r) => r.avg_lead_time_hours != null);
      const withScore = rows.filter((r) => r.responsiveness_score != null);
      const avgLead =
        withLead.length > 0
          ? withLead.reduce((s, r) => s + Number(r.avg_lead_time_hours), 0) / withLead.length
          : null;
      const avgScore =
        withScore.length > 0
          ? withScore.reduce((s, r) => s + Number(r.responsiveness_score), 0) / withScore.length
          : null;
      const flagged = withScore.filter(
        (r) => Number(r.responsiveness_score) < RESPONSIVENESS_THRESHOLD,
      );
      return { total: rows.length, avgLead, avgScore, flagged };
    },
    staleTime: 60_000,
  });

  if (vendorsQ.isLoading) return null;
  if (vendorsQ.isError) {
    return (
      <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
        {(vendorsQ.error as Error)?.message ?? "Vendor metrics failed to load."}
      </Card>
    );
  }

  const { total, avgLead, avgScore, flagged } = vendorsQ.data!;

  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Vendor metrics</h2>
        <Link to="/parts/vendors" className="text-xs text-primary underline-offset-2 hover:underline">
          All vendors ({total})
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Avg lead time</p>
          <p className="font-semibold tabular-nums">
            {avgLead != null ? `${avgLead.toFixed(1)} h` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Avg responsiveness</p>
          <p className="font-semibold tabular-nums">
            {avgScore != null ? avgScore.toFixed(2) : "—"}
          </p>
        </div>
      </div>
      {flagged.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            {flagged.length} vendor{flagged.length > 1 ? "s" : ""} below responsiveness threshold
            ({RESPONSIVENESS_THRESHOLD})
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {flagged.slice(0, 5).map((v) => (
              <li key={v.id}>
                {v.name} — {Number(v.responsiveness_score).toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
