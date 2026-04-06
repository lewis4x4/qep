import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const RESPONSIVENESS_THRESHOLD = 0.4;

interface VendorRow {
  id: string;
  name: string;
  avg_lead_time_hours: number | null;
  responsiveness_score: number | null;
  fill_rate: number | null;
  price_competitiveness: number | null;
  composite_score: number | null;
  machine_down_priority: boolean;
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function scoreBar(value: number | null, max = 1) {
  if (value == null) return null;
  const pctWidth = Math.min(100, (value / max) * 100);
  const color =
    value >= 0.7 ? "bg-emerald-500" : value >= 0.4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full h-1.5 rounded-full bg-muted/60 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pctWidth}%` }} />
    </div>
  );
}

export function VendorMetricsCard() {
  const vendorsQ = useQuery({
    queryKey: ["vendor-metrics-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_profiles")
        .select(
          "id, name, avg_lead_time_hours, responsiveness_score, fill_rate, price_competitiveness, composite_score, machine_down_priority",
        );
      if (error) throw error;

      const rows = (data ?? []) as VendorRow[];
      const withLead = rows.filter((r) => r.avg_lead_time_hours != null);
      const withScore = rows.filter((r) => r.responsiveness_score != null);
      const withFill = rows.filter((r) => r.fill_rate != null);
      const withComposite = rows.filter((r) => r.composite_score != null);
      const machineDown = rows.filter((r) => r.machine_down_priority);

      const avg = (arr: number[]) =>
        arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

      const avgLead = avg(withLead.map((r) => Number(r.avg_lead_time_hours)));
      const avgResp = avg(withScore.map((r) => Number(r.responsiveness_score)));
      const avgFill = avg(withFill.map((r) => Number(r.fill_rate)));
      const avgComposite = avg(withComposite.map((r) => Number(r.composite_score)));

      const flagged = withScore.filter(
        (r) => Number(r.responsiveness_score) < RESPONSIVENESS_THRESHOLD,
      );

      const topVendors = [...rows]
        .filter((r) => r.composite_score != null)
        .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0))
        .slice(0, 3);

      return {
        total: rows.length,
        avgLead,
        avgResp,
        avgFill,
        avgComposite,
        machineDownCount: machineDown.length,
        flagged,
        topVendors,
      };
    },
    staleTime: 60_000,
  });

  if (vendorsQ.isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-20 rounded bg-muted animate-pulse" />
              <div className="h-5 w-12 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </Card>
    );
  }
  if (vendorsQ.isError) {
    return (
      <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
        {(vendorsQ.error as Error)?.message ?? "Vendor metrics failed to load."}
      </Card>
    );
  }

  const {
    total,
    avgLead,
    avgResp,
    avgFill,
    avgComposite,
    machineDownCount,
    flagged,
    topVendors,
  } = vendorsQ.data!;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Vendor scorecard</h2>
        <div className="flex items-center gap-2">
          {machineDownCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-600 dark:text-red-400">
              {machineDownCount} machine-down
            </Badge>
          )}
          <Link to="/parts/vendors" className="text-xs text-primary underline-offset-2 hover:underline">
            All ({total})
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Avg lead time</p>
          <p className="font-semibold tabular-nums">
            {avgLead != null ? `${avgLead.toFixed(1)} h` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Avg fill rate</p>
          <p className="font-semibold tabular-nums">{pct(avgFill)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Avg responsiveness</p>
          <p className="font-semibold tabular-nums">{pct(avgResp)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Composite score</p>
          <p className="font-semibold tabular-nums">{pct(avgComposite)}</p>
          {scoreBar(avgComposite)}
        </div>
      </div>

      {topVendors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground uppercase">Top vendors</p>
          {topVendors.map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-xs">
              <span className="font-medium truncate flex-1">{v.name}</span>
              {v.machine_down_priority && (
                <span className="text-[10px] text-red-600 dark:text-red-400">MD</span>
              )}
              <span className="tabular-nums text-muted-foreground">{pct(v.composite_score)}</span>
              <div className="w-16">{scoreBar(v.composite_score)}</div>
            </div>
          ))}
        </div>
      )}

      {flagged.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            {flagged.length} vendor{flagged.length > 1 ? "s" : ""} below responsiveness threshold
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {flagged.slice(0, 5).map((v) => (
              <li key={v.id}>
                {v.name} — {pct(Number(v.responsiveness_score))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
