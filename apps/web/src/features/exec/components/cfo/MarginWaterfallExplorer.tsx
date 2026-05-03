import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatKpiValue } from "../../lib/formatters";
import { normalizeExecMarginWaterfallRows, type ExecMarginWaterfallRow } from "../../lib/exec-row-normalizers";

interface Props {
  onDrill?: (metricKey: string) => void;
}

const DRILL_METRIC_KEY = "gross_margin_pct_mtd";

export function MarginWaterfallExplorer({ onDrill }: Props) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cfo", "margin-waterfall"],
    queryFn: async (): Promise<ExecMarginWaterfallRow[]> => {
      const res = await supabase
        .from("exec_margin_waterfall_v")
        .select("month, revenue, gross_margin_dollars, net_contribution_dollars, load_dollars, loaded_margin_pct")
        .order("month", { ascending: false })
        .limit(6);
      if (res.error) return [];
      return normalizeExecMarginWaterfallRows(res.data);
    },
    staleTime: 5 * 60_000,
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TrendingDown className="h-3.5 w-3.5 text-amber-400" />
        <p className="text-[11px] uppercase tracking-wider font-semibold text-foreground">Margin waterfall</p>
        <span className="ml-auto text-[10px] text-muted-foreground">last 6 months</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => onDrill?.(DRILL_METRIC_KEY)}>
            Drill margin
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-7 text-[10px]">
            <Link to="/service/invoice">Recover payments</Link>
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading waterfall…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Margin history has not populated yet. Closed deals and finance snapshots will appear here once enough activity is available.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Month</th>
                <th className="py-1.5 pr-2 text-right font-medium">Revenue</th>
                <th className="py-1.5 pr-2 text-right font-medium">Gross $</th>
                <th className="py-1.5 pr-2 text-right font-medium">Load $</th>
                <th className="py-1.5 pr-2 text-right font-medium">Net contrib</th>
                <th className="py-1.5 text-right font-medium">Loaded %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.month}
                  className="cursor-pointer border-b border-border/20 hover:bg-muted/20 focus-within:bg-muted/20"
                  onClick={() => onDrill?.(DRILL_METRIC_KEY)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onDrill?.(DRILL_METRIC_KEY);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Drill margin details for ${r.month.slice(0, 7)}`}
                >
                  <td className="py-1.5 pr-2 font-mono">{r.month.slice(0, 7)}</td>
                  <td className="py-1.5 pr-2 text-right">{formatKpiValue(r.revenue, "currency_compact")}</td>
                  <td className="py-1.5 pr-2 text-right text-emerald-400">{formatKpiValue(r.gross_margin_dollars, "currency_compact")}</td>
                  <td className="py-1.5 pr-2 text-right text-amber-400">{formatKpiValue(r.load_dollars, "currency_compact")}</td>
                  <td className="py-1.5 pr-2 text-right">{formatKpiValue(r.net_contribution_dollars ?? 0, "currency_compact")}</td>
                  <td className="py-1.5 text-right font-semibold">{r.loaded_margin_pct != null ? `${r.loaded_margin_pct.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
