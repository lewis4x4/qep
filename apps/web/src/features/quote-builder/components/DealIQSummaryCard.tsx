import { AlertTriangle, CheckCircle2, Gauge, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DealIqRisk, DealIqSummary, DealIqTone } from "../lib/deal-iq";

export interface DealIQSummaryCardProps {
  summary: DealIqSummary;
  policyLoading?: boolean;
  policyError?: string | null;
}

const TONE_CLASS: Record<DealIqTone, string> = {
  positive: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  danger: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
  muted: "border-border bg-muted/30 text-muted-foreground",
};

const BAND_LABEL: Record<DealIqSummary["winProbabilityBand"], string> = {
  strong: "Strong",
  healthy: "Healthy",
  mixed: "Mixed",
  at_risk: "At risk",
};

function riskClass(risk: DealIqRisk): string {
  if (risk.severity === "critical") return "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300";
  if (risk.severity === "warning") return "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300";
  return "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300";
}

function Metric({ label, value, detail, className }: {
  label: string;
  value: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-background/70 p-2", className)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      {detail && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{detail}</div>}
    </div>
  );
}

export function DealIQSummaryCard({ summary, policyLoading = false, policyError = null }: DealIQSummaryCardProps) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-semibold">Deal IQ</div>
              <div className="text-[11px] text-muted-foreground">Rep/internal economics snapshot</div>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px]">Internal only</Badge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Margin %" value={summary.marginPctLabel} detail={`Floor ${summary.floorPct.toFixed(1)}%`} />
          <Metric label="Margin $" value={summary.marginAmountLabel} />
          <Metric
            label="Win probability"
            value={`${summary.winProbabilityScore}%`}
            detail={BAND_LABEL[summary.winProbabilityBand]}
          />
          <Metric
            label="Commission"
            value={summary.commissionStatus.label}
            detail={summary.commissionStatus.detail}
            className={TONE_CLASS[summary.commissionStatus.tone]}
          />
        </div>

        <div className="rounded-lg border border-border bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {summary.winProbabilityHeadline}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            {summary.risks.length > 0 ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )}
            Flagged risks
          </div>

          {summary.risks.length === 0 ? (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] text-emerald-700 dark:text-emerald-300">
              No governance risks flagged.
            </div>
          ) : (
            <div className="space-y-1.5">
              {summary.risks.map((risk) => (
                <div key={risk.id} className={cn("rounded-md border p-2", riskClass(risk))}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{risk.label}</span>
                    <Badge variant="outline" className="text-[9px] capitalize">{risk.source.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed opacity-90">{risk.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {(policyLoading || policyError || !summary.policyCapsAvailable) && (
          <div className="flex gap-2 rounded-md border border-dashed border-border p-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {policyLoading
                ? "Loading approval policy caps…"
                : "Policy caps unavailable; using the default 10% margin floor only."}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
