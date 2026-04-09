/**
 * Revenue Reality Board — Track 1, Slice 1.1.
 *
 * Shows the financial truth of the pipeline with DGE-blended probability.
 * Six primary metric cards + stalled quotes indicator + blocker breakdown.
 */

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Clock4,
  DollarSign,
  Lock,
  Scale,
  ShieldAlert,
  Timer,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  BlockerBreakdownEntry,
  RevenueRealityBoardPayload,
  SectionFreshness,
} from "../api/commandCenter.types";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

type Tone = "neutral" | "ready" | "risk" | "warn";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-border/60 bg-card/60",
  ready: "border-emerald-500/40 bg-emerald-500/5",
  risk: "border-rose-500/40 bg-rose-500/5",
  warn: "border-amber-500/40 bg-amber-500/5",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  ready: "text-emerald-500",
  risk: "text-rose-500",
  warn: "text-amber-500",
};

const BLOCKER_LABELS: Record<string, string> = {
  deposit_missing: "Deposit Missing",
  margin_flagged: "Margin Flagged",
  anomaly_critical: "Critical Anomaly",
};

// ─── Sub-components ────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: Tone;
}

function MetricCard({ label, value, icon: Icon, tone }: MetricCardProps) {
  return (
    <Card className={cn("rounded-lg border p-3", TONE_CLASSES[tone])}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", TONE_TEXT[tone])} />
        <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", TONE_TEXT[tone])}>
        {value}
      </div>
    </Card>
  );
}

function BlockerChip({ entry }: { entry: BlockerBreakdownEntry }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
      <Lock className="h-3.5 w-3.5 text-rose-500" />
      <span className="text-xs font-medium text-rose-500">
        {BLOCKER_LABELS[entry.type] ?? entry.type}
      </span>
      <Badge variant="outline" className="border-rose-500/30 text-[10px] text-rose-500">
        {entry.count}
      </Badge>
      <span className="text-xs tabular-nums text-rose-400">
        {formatCurrency(entry.totalValue)}
      </span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

interface RevenueRealityBoardProps {
  payload: RevenueRealityBoardPayload;
  freshness: SectionFreshness;
}

export function RevenueRealityBoard({ payload, freshness }: RevenueRealityBoardProps) {
  // Guard: backend may not yet return this section (edge function not redeployed)
  if (!payload) return null;

  // Empty state
  if (payload.openPipeline === 0) {
    return (
      <Card className="border-dashed border-border/60 bg-card/40 p-4 text-xs text-muted-foreground">
        No open pipeline in this scope yet.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold tracking-tight">Revenue Reality</h3>
          {payload.dgeAvailability !== "none" && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                payload.dgeAvailability === "full"
                  ? "border-emerald-500/30 text-emerald-500"
                  : "border-amber-500/30 text-amber-500",
              )}
            >
              DGE-blended{payload.dgeAvailability === "partial" ? " (partial)" : ""}
            </Badge>
          )}
        </div>
        {freshness.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness.source}</span>
        )}
      </div>

      {/* Primary metrics grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Open Pipeline"
          value={formatCurrency(payload.openPipeline)}
          icon={DollarSign}
          tone="neutral"
        />
        <MetricCard
          label="Weighted Revenue"
          value={formatCurrency(payload.weightedRevenue)}
          icon={Scale}
          tone="neutral"
        />
        <MetricCard
          label="Closable 7d"
          value={formatCurrency(payload.closable7d)}
          icon={Timer}
          tone={payload.closable7d > 0 ? "ready" : "neutral"}
        />
        <MetricCard
          label="Closable 30d"
          value={formatCurrency(payload.closable30d)}
          icon={Timer}
          tone={payload.closable30d > 0 ? "ready" : "neutral"}
        />
        <MetricCard
          label="At Risk"
          value={formatCurrency(payload.atRisk)}
          icon={AlertTriangle}
          tone={payload.atRisk > 0 ? "risk" : "neutral"}
        />
        <MetricCard
          label="Margin at Risk"
          value={formatCurrency(payload.marginAtRisk)}
          icon={ShieldAlert}
          tone={payload.marginAtRisk > 0 ? "risk" : "neutral"}
        />
      </div>

      {/* Stalled quotes + blocker breakdown row */}
      <div className="flex flex-wrap items-start gap-2">
        {payload.stalledQuotes.count > 0 && (
          <Card className={cn("rounded-lg border p-3", TONE_CLASSES.warn)}>
            <div className="flex items-center gap-2">
              <Clock4 className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium text-amber-500">
                {payload.stalledQuotes.count} stalled quote{payload.stalledQuotes.count !== 1 ? "s" : ""}
              </span>
              <span className="text-xs tabular-nums text-amber-400">
                {formatCurrency(payload.stalledQuotes.totalValue)}
              </span>
            </div>
          </Card>
        )}

        {payload.blockedByType.map((entry) => (
          <BlockerChip key={entry.type} entry={entry} />
        ))}
      </div>
    </div>
  );
}
