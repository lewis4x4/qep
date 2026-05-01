import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Wrench, FileText, Package, AlertTriangle, TrendingUp, DollarSign,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EMPTY_ASSET_BADGES, parseAssetBadges, type AssetBadgeData } from "@/lib/asset-rpc";

interface AssetBadgeRowProps {
  equipmentId: string;
  className?: string;
}

/**
 * Six-badge summary row for an equipment record. Each badge tap-throughs
 * to its filtered list. Backed by get_asset_badges(p_equipment_id) RPC
 * (mig 161). Falls back to a quiet empty state until the RPC ships.
 */
export function AssetBadgeRow({ equipmentId, className = "" }: AssetBadgeRowProps) {
  const { data, isLoading } = useQuery<AssetBadgeData | null>({
    queryKey: ["asset", "badges", equipmentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_asset_badges", { p_equipment_id: equipmentId });
      if (error) return null;
      return parseAssetBadges(data);
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className={`h-12 animate-pulse rounded-md bg-muted/20 ${className}`} />;
  }

  const d = data ?? EMPTY_ASSET_BADGES;

  return (
    <div className={`grid grid-cols-3 gap-2 sm:grid-cols-6 ${className}`}>
      <Badge
        icon={<Wrench className="h-3.5 w-3.5" />}
        label="Open WOs"
        value={d.open_work_orders}
        href={`/service?equipment_id=${equipmentId}`}
        tone={d.open_work_orders > 0 ? "orange" : "neutral"}
      />
      <Badge
        icon={<FileText className="h-3.5 w-3.5" />}
        label="Open Quotes"
        value={d.open_quotes}
        href={`/quotes?equipment_id=${equipmentId}`}
        tone={d.open_quotes > 0 ? "blue" : "neutral"}
      />
      <Badge
        icon={<Package className="h-3.5 w-3.5" />}
        label="Pending Parts"
        value={d.pending_parts_orders}
        href={`/parts?equipment_id=${equipmentId}`}
        tone={d.pending_parts_orders > 0 ? "violet" : "neutral"}
      />
      <Badge
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        label="Overdue Intervals"
        value={d.overdue_intervals}
        tone={d.overdue_intervals > 0 ? "red" : "neutral"}
      />
      <Badge
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Trade-Up Score"
        value={d.trade_up_score}
        tone={d.trade_up_score >= 70 ? "green" : d.trade_up_score >= 40 ? "yellow" : "neutral"}
      />
      <Badge
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label="Lifetime Parts $"
        value={`$${(d.lifetime_parts_spend / 1000).toFixed(1)}K`}
        tone="neutral"
      />
    </div>
  );
}

const TONE: Record<string, string> = {
  orange:  "text-qep-orange border-qep-orange/30",
  blue:    "text-blue-400 border-blue-400/30",
  violet:  "text-violet-400 border-violet-400/30",
  red:     "text-red-400 border-red-400/30",
  green:   "text-emerald-400 border-emerald-400/30",
  yellow:  "text-amber-400 border-amber-400/30",
  neutral: "text-muted-foreground border-border",
};

function Badge({
  icon, label, value, href, tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  href?: string;
  tone?: string;
}) {
  const inner = (
    <div className={`rounded-md border bg-card p-2 ${TONE[tone]}`}>
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-[9px] uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className="mt-0.5 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}
