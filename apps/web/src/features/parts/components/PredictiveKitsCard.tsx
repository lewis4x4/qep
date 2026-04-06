import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { PredictiveKitsSummary, PredictiveKit } from "../hooks/usePredictiveKits";
import { useStageKit } from "../hooks/usePredictiveKits";

function stockBadge(status: string) {
  if (status === "all_in_stock") {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
        All stocked
      </Badge>
    );
  }
  if (status === "partial") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400">
        Partial
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-600 dark:text-red-400">
      None stocked
    </Badge>
  );
}

function dollars(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function KitRow({ kit }: { kit: PredictiveKit }) {
  const [expanded, setExpanded] = useState(false);
  const stageMut = useStageKit();
  const equipment = [kit.equipment_make, kit.equipment_model]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded border border-border/50 p-2 text-xs space-y-1">
      <button
        type="button"
        className="flex items-start gap-2 cursor-pointer w-full text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-medium truncate">
              {kit.company_name ?? "Unknown customer"}
            </span>
            {stockBadge(kit.stock_status)}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {equipment && <span>{equipment}</span>}
            {kit.current_hours != null && <span>· {kit.current_hours.toLocaleString()}h</span>}
            <span>· {kit.predicted_service_window}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold tabular-nums">{dollars(kit.kit_value)}</p>
          <p className="text-muted-foreground">
            {kit.kit_part_count} part{kit.kit_part_count !== 1 ? "s" : ""}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="pt-2 space-y-1.5 border-t border-border/30">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Confidence: {(kit.confidence * 100).toFixed(0)}%</span>
            {kit.predicted_failure_type && (
              <>
                <span>·</span>
                <span>{kit.predicted_failure_type.replace(/_/g, " ")}</span>
              </>
            )}
            {kit.nearest_branch_id && (
              <>
                <span>·</span>
                <span>Branch: {kit.nearest_branch_id}</span>
              </>
            )}
          </div>
          <div className="space-y-0.5">
            {kit.kit_parts.slice(0, 8).map((p) => (
              <div key={p.part_number} className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${p.in_stock ? "bg-emerald-500" : "bg-red-500"}`}
                />
                <span className="font-mono">{p.part_number}</span>
                <span className="text-muted-foreground truncate">
                  ×{p.quantity}
                  {p.description ? ` — ${p.description}` : ""}
                </span>
              </div>
            ))}
            {kit.kit_parts.length > 8 && (
              <p className="text-muted-foreground">
                +{kit.kit_parts.length - 8} more parts
              </p>
            )}
          </div>
          {kit.stock_status === "all_in_stock" && kit.status !== "staged" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-xs h-7 mt-1"
              disabled={stageMut.isPending}
              onClick={() => stageMut.mutate(kit.id)}
            >
              {stageMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Pre-stage this kit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  data?: PredictiveKitsSummary;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

export function PredictiveKitsCard({ data, isLoading, isError, errorMessage }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground animate-pulse">Loading predictive kits…</p>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
        {errorMessage ?? "Failed to load predictive kits."}
      </Card>
    );
  }

  if (!data || data.kits.length === 0) {
    return (
      <Card className="p-4 space-y-1">
        <h2 className="text-sm font-medium">Predictive kits</h2>
        <p className="text-xs text-muted-foreground">
          No upcoming service predictions. Fleet data and service history power this feature.
        </p>
      </Card>
    );
  }

  const { kits, suggestedCount, allInStockCount, partialCount, totalKitValue } = data;
  const shown = showAll ? kits : kits.slice(0, 4);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Predictive kits</h2>
        <Link
          to="/parts/inventory"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          Inventory
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Suggested</p>
          <p className="font-semibold tabular-nums">{suggestedCount}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Ready</p>
          <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {allInStockCount}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Kit value</p>
          <p className="font-semibold tabular-nums">{dollars(totalKitValue)}</p>
        </div>
      </div>

      {partialCount > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          {partialCount} kit{partialCount > 1 ? "s" : ""} need parts ordered
        </div>
      )}

      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {shown.map((kit) => (
          <KitRow key={kit.id} kit={kit} />
        ))}
      </div>

      {kits.length > 4 && (
        <button
          type="button"
          className="text-xs text-primary hover:underline underline-offset-2"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show less" : `Show all ${kits.length} kits`}
        </button>
      )}
    </Card>
  );
}
