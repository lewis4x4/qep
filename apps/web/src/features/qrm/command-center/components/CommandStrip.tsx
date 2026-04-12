import { Activity, AlertTriangle, Clock4, DollarSign, Lock, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  CommandStripPayload,
  SectionFreshness,
} from "../api/commandCenter.types";
import { ScopeSwitcher } from "./ScopeSwitcher";
import type { CommandCenterScope } from "../api/commandCenter.types";

interface CommandStripProps {
  payload: CommandStripPayload;
  freshness: SectionFreshness;
  scope: CommandCenterScope;
  onScopeChange: (next: CommandCenterScope) => void;
  isElevatedViewer: boolean;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function relativeFreshness(generatedAt: string): string {
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

interface MetricChipProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "neutral" | "warn" | "risk";
}

function MetricChip({ label, value, icon: Icon, tone }: MetricChipProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2",
        tone === "neutral" && "border-border/60 bg-card/60",
        tone === "warn" && "border-qep-orange/40 bg-qep-orange/5",
        tone === "risk" && "border-rose-500/40 bg-rose-500/5",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="text-sm font-bold leading-tight text-foreground">{value}</div>
    </div>
  );
}

export function CommandStrip({
  payload,
  freshness,
  scope,
  onScopeChange,
  isElevatedViewer,
}: CommandStripProps) {
  return (
    <Card className="border-qep-orange/20 bg-gradient-to-r from-qep-orange/[0.06] to-transparent p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-qep-orange" />
            <p className="text-sm font-medium leading-snug text-foreground">{payload.narrative}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "border-border/60 text-[10px] uppercase tracking-wide",
                freshness.source === "live" && "text-emerald-500",
                freshness.source === "degraded" && "text-amber-500",
                freshness.source === "unavailable" && "text-rose-500",
              )}
            >
              {freshness.source} · {relativeFreshness(freshness.generatedAt)}
            </Badge>
            <ScopeSwitcher
              scope={scope}
              onChange={onScopeChange}
              canUseElevatedScopes={isElevatedViewer}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricChip
            label="Closable 7d"
            value={formatCurrency(payload.closableRevenue7d)}
            icon={DollarSign}
            tone="neutral"
          />
          <MetricChip
            label="Closable 30d"
            value={formatCurrency(payload.closableRevenue30d)}
            icon={DollarSign}
            tone="neutral"
          />
          <MetricChip
            label="At risk"
            value={formatCurrency(payload.atRiskRevenue)}
            icon={AlertTriangle}
            tone={payload.atRiskRevenue > 0 ? "risk" : "neutral"}
          />
          <MetricChip
            label="Blocked deals"
            value={String(payload.blockedDeals)}
            icon={Lock}
            tone={payload.blockedDeals > 0 ? "warn" : "neutral"}
          />
          <MetricChip
            label="Overdue follow-ups"
            value={String(payload.overdueFollowUps)}
            icon={Clock4}
            tone={payload.overdueFollowUps > 0 ? "warn" : "neutral"}
          />
          <MetricChip
            label="Approvals"
            value={String(payload.urgentApprovals)}
            icon={Activity}
            tone={payload.urgentApprovals > 0 ? "warn" : "neutral"}
          />
        </div>
      </div>
    </Card>
  );
}
