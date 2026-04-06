import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import type { PipelineHealthRow } from "../lib/pipeline-health";

interface PipelineHealthByRepCardProps {
  rows: PipelineHealthRow[];
}

function MiniBar(props: { label: string; value: number; max: number; className: string }) {
  const { label, value, max, className } = props;
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-muted-foreground w-14 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden min-w-0">
        <div className={`h-full rounded-full transition-all ${className}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right shrink-0">{value}</span>
    </div>
  );
}

export function PipelineHealthByRepCard({ rows }: PipelineHealthByRepCardProps) {
  if (rows.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Pipeline by advisor</h3>
        </div>
        <p className="text-sm text-muted-foreground">No open deals in the current sample.</p>
      </Card>
    );
  }

  const maxLane = Math.max(1, ...rows.map((r) => Math.max(r.preSale, r.close, r.postSale)));

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-foreground">Pipeline by advisor</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Open deals in sample (up to 250), grouped into pre-sale (steps 1–12), close (13–16), and post-sale (17–21). Idle = avg days since last activity.
      </p>
      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.repKey} className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{row.displayName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {row.dealCount} deals · ${(row.totalValue / 1000).toFixed(0)}K · idle{" "}
                  {row.avgDaysIdle != null ? `${row.avgDaysIdle}d` : "—"}
                </p>
              </div>
              {row.repKey !== "__unassigned__" && (
                <Link to="/qrm/pipeline" className="text-[10px] font-medium text-qep-orange hover:underline shrink-0">
                  Open pipeline
                </Link>
              )}
            </div>
            <MiniBar label="Pre" value={row.preSale} max={maxLane} className="bg-blue-500/80" />
            <MiniBar label="Close" value={row.close} max={maxLane} className="bg-amber-500/80" />
            <MiniBar label="Post" value={row.postSale} max={maxLane} className="bg-emerald-500/80" />
          </div>
        ))}
      </div>
    </Card>
  );
}
