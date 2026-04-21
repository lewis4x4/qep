import { AlertTriangle, ArrowDown, ArrowUp, Calendar, Link as LinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DocumentCenterNeighbor } from "@/features/documents/router";

export interface ContextPaneNeighborsProps {
  neighbors: DocumentCenterNeighbor[];
  loading: boolean;
}

function formatWindow(neighbor: DocumentCenterNeighbor): string {
  if (neighbor.validUntil) {
    return `until ${new Date(neighbor.validUntil).toLocaleDateString()}`;
  }
  if (neighbor.validFrom) {
    return `from ${new Date(neighbor.validFrom).toLocaleDateString()}`;
  }
  return "no window";
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function edgeLabel(edgeType: string): string {
  return edgeType.replace(/_/g, " ");
}

function targetLabel(neighbor: DocumentCenterNeighbor): string {
  if (neighbor.toEntityLabel) return neighbor.toEntityLabel;
  if (neighbor.toDocumentId) return "another document";
  if (neighbor.toEntityType) return neighbor.toEntityType;
  return "—";
}

export function ContextPaneNeighbors({ neighbors, loading }: ContextPaneNeighborsProps) {
  if (loading) {
    return (
      <div className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
        Loading obligations…
      </div>
    );
  }

  if (neighbors.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        No obligations derived yet. Run the document twin to populate this graph.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {neighbors.map((neighbor) => {
        const atRisk = neighbor.status === "at_risk";
        const days = daysUntil(neighbor.validUntil);
        return (
          <div
            key={neighbor.id}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1.5",
              atRisk ? "border-amber-500/60 bg-amber-500/5" : "border-border/80",
            )}
          >
            {atRisk ? (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
            ) : neighbor.direction === "outbound" ? (
              <ArrowUp className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ArrowDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground">
                <span className="font-medium">{edgeLabel(neighbor.edgeType)}</span>{" "}
                <span className="text-muted-foreground">→ {targetLabel(neighbor)}</span>
              </p>
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Calendar className="h-2.5 w-2.5" />
                {formatWindow(neighbor)}
                {days !== null && days >= 0 && days <= 30 ? (
                  <span className={cn(days <= 14 ? "text-amber-500" : "text-muted-foreground")}>
                    · {days}d remaining
                  </span>
                ) : null}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
              {neighbor.status.replace(/_/g, " ")}
            </Badge>
            {neighbor.sourceFactIds.length > 0 ? (
              <LinkIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has source facts" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
