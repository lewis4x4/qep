import { Card } from "@/components/ui/card";
import { useCrossReferences, relationshipLabel } from "../hooks/useCrossReferences";
import type { SubstituteRow } from "../hooks/useCrossReferences";

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.95 ? "bg-green-500" :
    confidence >= 0.8 ? "bg-yellow-500" :
    confidence >= 0.5 ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

function SubstituteItem({ row }: { row: SubstituteRow }) {
  const hasStock = row.qty_available > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 py-1 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <ConfidenceDot confidence={row.confidence} />
        <span className="font-mono text-xs font-medium truncate">{row.substitute_part_number}</span>
        <span className="text-[10px] text-muted-foreground">{relationshipLabel(row.relationship)}</span>
      </div>

      <div className="flex items-center gap-2 text-xs shrink-0">
        {hasStock ? (
          <span className="text-green-700 dark:text-green-400 font-medium tabular-nums">
            {row.qty_available} avail
            {row.available_branch && <span className="text-muted-foreground font-normal"> @ {row.available_branch}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">No stock</span>
        )}
        {row.price_delta != null && row.price_delta !== 0 && (
          <span className={`tabular-nums text-[10px] ${row.price_delta < 0 ? "text-green-600" : "text-amber-600"}`}>
            {row.price_delta > 0 ? "+" : ""}{row.price_delta.toFixed(2)}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {Math.round(row.confidence * 100)}%
        </span>
      </div>

      {(row.fitment_notes || row.catalog_description) && (
        <div className="w-full text-[10px] text-muted-foreground pl-4 truncate">
          {row.fitment_notes ?? row.catalog_description}
        </div>
      )}
    </div>
  );
}

export function PartCrossRefPanel({
  partNumber,
  branchId,
  compact = false,
}: {
  partNumber: string | null | undefined;
  branchId?: string | null;
  compact?: boolean;
}) {
  const xrefQ = useCrossReferences(partNumber, branchId);

  if (!partNumber) return null;
  if (xrefQ.isLoading) {
    return compact ? null : (
      <p className="text-[10px] text-muted-foreground">Loading substitutes…</p>
    );
  }

  const rows = xrefQ.data ?? [];
  if (rows.length === 0) return null;

  const withStock = rows.filter((r) => r.qty_available > 0);

  if (compact) {
    if (withStock.length === 0) return null;
    return (
      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
        {withStock.length} sub{withStock.length !== 1 ? "s" : ""} in stock
      </span>
    );
  }

  return (
    <Card className="p-3 border-blue-500/20 bg-blue-500/5">
      <p className="text-xs font-medium mb-1.5">
        Substitutes for <span className="font-mono">{partNumber}</span>
        {withStock.length > 0 && (
          <span className="ml-1.5 text-green-700 dark:text-green-400">
            ({withStock.length} in stock)
          </span>
        )}
      </p>
      <div className="space-y-0">
        {rows.slice(0, 8).map((r) => (
          <SubstituteItem key={`${r.xref_id}-${r.available_branch ?? "all"}`} row={r} />
        ))}
      </div>
      {rows.length > 8 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          +{rows.length - 8} more…
        </p>
      )}
    </Card>
  );
}
