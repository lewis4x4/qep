import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PartsSubNav } from "../components/PartsSubNav";
import { PartCommandPanel, type BranchCell } from "../components/PartCommandPanel";
import type { Database } from "@/lib/database.types";
import type { ForecastRow } from "../hooks/useDemandForecast";
import { normalizeForecastRows } from "../lib/parts-row-normalizers";

type CatalogRow = Database["public"]["Tables"]["parts_catalog"]["Row"];

type ForecastBucket = "action" | "watch" | "covered" | "no_signal";

type Signal = "fresh" | "stale";

const BUCKET_STYLES: Record<
  ForecastBucket,
  { dot: string; label: string; text: string; rank: number }
> = {
  action: { dot: "bg-red-500", label: "Action", text: "text-red-700 dark:text-red-400", rank: 4 },
  watch: { dot: "bg-amber-500", label: "Watch", text: "text-amber-700 dark:text-amber-400", rank: 3 },
  covered: { dot: "bg-green-500", label: "Covered", text: "text-green-700 dark:text-green-400", rank: 2 },
  no_signal: { dot: "bg-muted-foreground/30", label: "No signal", text: "text-muted-foreground", rank: 1 },
};

function formatMonth(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function classify(
  row: ForecastRow,
  liveOnHand: number | null,
): { bucket: ForecastBucket; daysLeft: number | null } {
  const drivers = row.drivers ?? {};
  const hasSignal =
    (row.predicted_qty ?? 0) > 0 ||
    (typeof drivers.order_history === "number" && (drivers.order_history as number) > 0) ||
    (typeof drivers.active_months_12mo === "number" && (drivers.active_months_12mo as number) > 0);
  if (!hasSignal) return { bucket: "no_signal", daysLeft: null };

  const onHand = liveOnHand ?? row.current_qty_on_hand ?? 0;
  const predicted = row.predicted_qty ?? 0;
  const velocity = row.consumption_velocity ?? null;
  const daysLeft =
    velocity && velocity > 0
      ? Math.round((onHand / velocity) * 10) / 10
      : row.days_of_stock_remaining;

  if (predicted > 0 && onHand < predicted) return { bucket: "action", daysLeft };
  if (predicted > 0 && onHand < predicted * 1.5) return { bucket: "watch", daysLeft };
  return { bucket: "covered", daysLeft };
}

export function PartsForecastPage() {
  const [bucketFilter, setBucketFilter] = useState<"all" | ForecastBucket>("all");
  const [selectedPart, setSelectedPart] = useState<CatalogRow | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelBranches, setPanelBranches] =
    useState<Map<string, BranchCell> | undefined>(undefined);
  const [panelTotal, setPanelTotal] = useState(0);

  // Primary forecast pull — prefer the enriched view, fall back to the raw table.
  const forecastQ = useQuery({
    queryKey: ["parts-forecast-full"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ForecastRow[]> => {
      const { data: v, error: vErr } = await supabase
        .from("parts_forecast_risk_summary")
        .select("*")
        .order("stockout_risk")
        .limit(500);
      if (!vErr && v) return normalizeForecastRows(v);

      const { data, error } = await supabase
        .from("parts_demand_forecasts")
        .select("*")
        .order("stockout_risk")
        .limit(500);
      if (error) throw error;
      return normalizeForecastRows(data, { fallbackFromRisk: true });
    },
  });

  // Live inventory so we can reconcile branch_id mismatch between the forecast
  // (writes parts_catalog.branch_code like "01") and inventory ("gulf-depot").
  // We group by part_number and sum; branch-level join is handled separately.
  const liveInvQ = useQuery({
    queryKey: ["parts-forecast-live-inv"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("part_number, branch_id, qty_on_hand, bin_location")
        .is("deleted_at", null);
      if (error) throw error;
      const byPart = new Map<string, number>();
      const byPartBranch = new Map<string, number>();
      for (const r of data ?? []) {
        const pn = (r.part_number as string).toLowerCase();
        byPart.set(pn, (byPart.get(pn) ?? 0) + Number(r.qty_on_hand));
        byPartBranch.set(`${pn}::${r.branch_id}`, Number(r.qty_on_hand));
      }
      return { byPart, byPartBranch };
    },
  });

  const branchesQ = useQuery({
    queryKey: ["parts-forecast-branches"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, short_code, slug, display_name")
        .is("deleted_at", null);
      if (error) throw error;
      const byKey = new Map<string, string>();
      for (const b of data ?? []) {
        const name = b.display_name as string;
        for (const k of [b.id, b.short_code, b.slug] as (string | null)[]) {
          if (k) byKey.set(k.toLowerCase(), name);
        }
      }
      return byKey;
    },
  });

  const catalogQ = useQuery({
    queryKey: ["parts-forecast-catalog-lookup"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_catalog")
        .select("*")
        .is("deleted_at", null);
      if (error) throw error;
      const byPart = new Map<string, CatalogRow>();
      for (const r of data ?? []) {
        const pn = r.part_number.toLowerCase();
        // keep first non-empty pick (richest coalesced row)
        const prev = byPart.get(pn);
        if (!prev) byPart.set(pn, r);
      }
      return byPart;
    },
  });

  const rows = forecastQ.data ?? [];

  const enriched = useMemo(() => {
    const byPart = liveInvQ.data?.byPart;
    const byPartBranch = liveInvQ.data?.byPartBranch;
    const branchNames = branchesQ.data;
    return rows.map((r) => {
      const pn = r.part_number.toLowerCase();
      const pbKey = `${pn}::${r.branch_id}`;
      const liveForPartBranch = byPartBranch?.get(pbKey) ?? null;
      // Fallback: if branch_id didn't resolve, pick the total as a "real stock exists somewhere" hint.
      const liveForPart = byPart?.get(pn) ?? null;
      const liveOnHand = liveForPartBranch ?? null;
      const { bucket, daysLeft } = classify(r, liveOnHand);
      const branchName = branchNames?.get((r.branch_id ?? "").toLowerCase()) ?? r.branch_id;
      return {
        row: r,
        branchName,
        branchMatched: liveForPartBranch != null,
        liveOnHand,
        liveOnHandTotal: liveForPart,
        bucket,
        daysLeft,
      };
    });
  }, [rows, liveInvQ.data, branchesQ.data]);

  const counts: Record<"all" | ForecastBucket, number> = {
    all: enriched.length,
    action: 0,
    watch: 0,
    covered: 0,
    no_signal: 0,
  };
  for (const e of enriched) counts[e.bucket]++;

  const filtered = useMemo(() => {
    const list = bucketFilter === "all" ? enriched : enriched.filter((e) => e.bucket === bucketFilter);
    return [...list].sort((a, b) => {
      const bDiff = BUCKET_STYLES[b.bucket].rank - BUCKET_STYLES[a.bucket].rank;
      if (bDiff !== 0) return bDiff;
      const ad = a.daysLeft ?? Infinity;
      const bd = b.daysLeft ?? Infinity;
      if (ad !== bd) return ad - bd;
      return a.row.part_number.localeCompare(b.row.part_number);
    });
  }, [enriched, bucketFilter]);

  // Freshness signal
  const latestComputed = useMemo(() => {
    let max = 0;
    for (const r of rows) {
      const t = new Date(r.computed_at).getTime();
      if (!Number.isNaN(t) && t > max) max = t;
    }
    return max > 0 ? new Date(max) : null;
  }, [rows]);

  const freshness: Signal | null = latestComputed
    ? Date.now() - latestComputed.getTime() < 8 * 24 * 3600 * 1000
      ? "fresh"
      : "stale"
    : null;

  const branchMatchRate =
    enriched.length > 0
      ? enriched.filter((e) => e.branchMatched).length / enriched.length
      : 1;

  const openPart = (e: (typeof enriched)[number]) => {
    const catalog = catalogQ.data?.get(e.row.part_number.toLowerCase());
    if (!catalog) return;
    setSelectedPart(catalog);
    setPanelTotal(e.liveOnHandTotal ?? 0);
    setPanelBranches(undefined);
    setPanelOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Demand forecast</h1>
          <p className="text-sm text-muted-foreground mt-1">
            90-day forward projection reconciled against live on-hand. Click a part to open the Command Panel.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {freshness && latestComputed && (
            <Badge variant={freshness === "fresh" ? "secondary" : "outline"}>
              {freshness === "fresh" ? "Fresh" : "Stale"} · updated {latestComputed.toLocaleDateString()}
            </Badge>
          )}
          {branchMatchRate < 0.5 && enriched.length > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-700 dark:text-amber-400"
              title="Forecast branch codes don't match live inventory branches — a cron sync is needed."
            >
              Branch sync lag
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryTile
          label="Action needed"
          value={counts.action}
          tone="bg-red-500/10 border-red-500/30"
          valueClass="text-red-700 dark:text-red-400"
        />
        <SummaryTile
          label="Watch"
          value={counts.watch}
          tone="bg-amber-500/10 border-amber-500/30"
          valueClass="text-amber-700 dark:text-amber-400"
        />
        <SummaryTile
          label="Covered"
          value={counts.covered}
          tone="bg-green-500/10 border-green-500/30"
          valueClass="text-green-700 dark:text-green-400"
        />
        <SummaryTile
          label="No signal"
          value={counts.no_signal}
          tone="bg-muted/40"
          valueClass="text-muted-foreground"
          hint="Not enough order history for a prediction"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["all", "action", "watch", "covered", "no_signal"] as const).map((level) => {
          const active = bucketFilter === level;
          const count = counts[level];
          const label =
            level === "all" ? "All" : BUCKET_STYLES[level as ForecastBucket].label;
          return (
            <Button
              key={level}
              type="button"
              size="sm"
              variant={active ? "default" : "secondary"}
              onClick={() => setBucketFilter(level)}
              className="h-7 text-xs"
            >
              {label}
              <span className="ml-1.5 tabular-nums opacity-70">({count})</span>
            </Button>
          );
        })}
      </div>

      {forecastQ.isLoading ? (
        <div className="flex justify-center py-16" role="status">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : forecastQ.isError ? (
        <Card className="p-4 text-sm text-destructive border-destructive/40">
          {(forecastQ.error as Error)?.message ?? "Failed to load forecast data."}
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No forecast data available. Deploy migration 137 and run the parts-demand-forecast cron.
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          No parts in the “{bucketFilter}” bucket.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Signal</th>
                <th className="px-3 py-2 font-medium">Part #</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium text-right">Predicted</th>
                <th className="px-3 py-2 font-medium text-right">Range</th>
                <th className="px-3 py-2 font-medium text-right">On hand</th>
                <th className="px-3 py-2 font-medium text-right">Days left</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const r = e.row;
                const style = BUCKET_STYLES[e.bucket];
                const displayOnHand = e.liveOnHand ?? e.row.qty_on_hand_at_forecast;
                const range =
                  r.confidence_low === r.confidence_high
                    ? r.predicted_qty.toFixed(0)
                    : `${r.confidence_low.toFixed(0)}–${r.confidence_high.toFixed(0)}`;
                return (
                  <tr
                    key={`${r.part_number}-${r.branch_id}-${r.forecast_month}-${i}`}
                    className="border-b border-border/30 hover:bg-accent/40 cursor-pointer outline-none focus-visible:bg-accent/60"
                    onClick={() => openPart(e)}
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        openPart(e);
                      }
                    }}
                  >
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase ${style.text}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">{r.part_number}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {e.branchName}
                      {!e.branchMatched && (
                        <span
                          className="ml-1 text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
                          title="Forecast branch_id doesn't match any live inventory branch"
                        >
                          unmapped
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{formatMonth(r.forecast_month)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {r.predicted_qty.toFixed(0)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {range}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {displayOnHand != null ? displayOnHand : "—"}
                      {e.liveOnHand == null && e.liveOnHandTotal != null && e.liveOnHandTotal > 0 && (
                        <span
                          className="ml-1 text-[10px] text-muted-foreground"
                          title={`Total across all branches: ${e.liveOnHandTotal}`}
                        >
                          ({e.liveOnHandTotal} total)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {e.daysLeft != null ? (
                        <span
                          className={
                            e.daysLeft <= 7
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : e.daysLeft <= 21
                              ? "text-amber-600 dark:text-amber-400"
                              : ""
                          }
                        >
                          {e.daysLeft}d
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <PartCommandPanel
        row={selectedPart}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        branches={panelBranches}
        totalStock={panelTotal}
        canMutate={false}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  valueClass,
  hint,
}: {
  label: string;
  value: number;
  tone: string;
  valueClass: string;
  hint?: string;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`} title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
