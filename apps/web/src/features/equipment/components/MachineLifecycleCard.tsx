import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { EMPTY_ASSET_BADGES, parseAssetBadges, type AssetBadgeData } from "@/lib/asset-rpc";
import { deriveMachineLifecycleState } from "../lib/machine-lifecycle";
import { normalizeLifecycleSummary, type LifecycleSummaryRow } from "../lib/equipment-row-normalizers";

interface MachineLifecycleCardProps {
  equipmentId: string;
  serialNumber: string | null | undefined;
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned";
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function toneClass(tone: string): string {
  switch (tone) {
    case "amber":
      return "border-amber-500/30 text-amber-400";
    case "orange":
      return "border-qep-orange/30 text-qep-orange";
    case "emerald":
      return "border-emerald-500/30 text-emerald-400";
    case "red":
      return "border-red-500/30 text-red-400";
    case "slate":
      return "border-border text-muted-foreground";
    default:
      return "border-blue-500/30 text-blue-400";
  }
}

function revenueTotal(value: Record<string, unknown> | null | undefined): number {
  if (!value || typeof value !== "object") return 0;
  return ["parts", "service", "purchase", "rental"].reduce((sum, key) => {
    const amount = Number(value[key] ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export function MachineLifecycleCard({
  equipmentId,
  serialNumber,
  ownership,
  availability,
}: MachineLifecycleCardProps) {
  const badgesQuery = useQuery<AssetBadgeData>({
    queryKey: ["machine-lifecycle", "badges", equipmentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_asset_badges", { p_equipment_id: equipmentId });
      if (error) throw new Error(error.message ?? "Failed to load lifecycle badges.");
      return parseAssetBadges(data);
    },
    staleTime: 60_000,
  });

  const lifecycleSummaryQuery = useQuery<LifecycleSummaryRow | null>({
    queryKey: ["machine-lifecycle", "summary", serialNumber ?? "none"],
    enabled: Boolean(serialNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_lifecycle_summary")
        .select("predicted_replacement_date, replacement_confidence, customer_health_score, revenue_breakdown")
        .eq("equipment_serial", serialNumber!)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return normalizeLifecycleSummary(data);
    },
    staleTime: 60_000,
  });

  const badges = badgesQuery.data ?? EMPTY_ASSET_BADGES;

  const lifecycle = deriveMachineLifecycleState({
    ownership,
    availability,
    openWorkOrders: badges.open_work_orders,
    openQuotes: badges.open_quotes,
    pendingPartsOrders: badges.pending_parts_orders,
    overdueIntervals: badges.overdue_intervals,
    tradeUpScore: badges.trade_up_score,
    predictedReplacementDate: lifecycleSummaryQuery.data?.predicted_replacement_date ?? null,
    replacementConfidence: lifecycleSummaryQuery.data?.replacement_confidence ?? null,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lifecycle</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">{lifecycle.label}</h3>
        </div>
        <Badge variant="outline" className={toneClass(lifecycle.tone)}>
          {lifecycle.phase.replace(/_/g, " ")}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{lifecycle.detail}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Open work" value={String(badges.open_work_orders)} />
        <Stat label="Open quotes" value={String(badges.open_quotes)} />
        <Stat label="Trade-up score" value={String(badges.trade_up_score)} />
      </div>

      {(lifecycleSummaryQuery.data?.customer_health_score != null || lifecycleSummaryQuery.data?.revenue_breakdown) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Stat
            label="Customer health"
            value={lifecycleSummaryQuery.data?.customer_health_score != null ? String(Math.round(lifecycleSummaryQuery.data.customer_health_score)) : "—"}
          />
          <Stat
            label="Lifecycle revenue"
            value={currency(revenueTotal(lifecycleSummaryQuery.data?.revenue_breakdown))}
          />
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
