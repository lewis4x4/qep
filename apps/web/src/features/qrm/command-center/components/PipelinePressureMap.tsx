import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  PipelineMetaStage,
  PipelinePressurePayload,
  PipelineRiskState,
  PipelineStageBucket,
  SectionFreshness,
} from "../api/commandCenter.types";

interface PipelinePressureMapProps {
  payload: PipelinePressurePayload;
  freshness: SectionFreshness;
}

const META_STAGE_LABEL: Record<PipelineMetaStage, string> = {
  early_funnel: "Early funnel",
  quote_validation: "Quote & validation",
  close_funding: "Close & funding",
  readiness_delivery: "Readiness & delivery",
  post_sale: "Post-sale",
};

const META_STAGE_ORDER: PipelineMetaStage[] = [
  "early_funnel",
  "quote_validation",
  "close_funding",
  "readiness_delivery",
  "post_sale",
];

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function riskClassName(state: PipelineRiskState): string {
  switch (state) {
    case "healthy":
      return "border-emerald-500/40 text-emerald-500";
    case "watch":
      return "border-amber-500/40 text-amber-500";
    case "critical":
      return "border-rose-500/40 text-rose-500";
  }
}

function StageRow({ stage }: { stage: PipelineStageBucket }) {
  return (
    <Link
      to={`/qrm/pipeline?stage=${stage.id}`}
      className="group flex items-center justify-between rounded-md border border-border/40 bg-card/60 px-3 py-2 transition-colors hover:border-qep-orange/40 hover:bg-card"
    >
      <div className="min-w-0 flex-1 pr-3">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{stage.name}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px] uppercase tracking-wide", riskClassName(stage.riskState))}
          >
            {stage.riskState}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{stage.count} deal{stage.count === 1 ? "" : "s"}</span>
          <span>{formatCurrency(stage.amount)}</span>
          {stage.avgDaysInStage !== null && <span>~{stage.avgDaysInStage}d in stage</span>}
          {stage.stuckCount > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3 w-3" /> {stage.stuckCount} stuck
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

export function PipelinePressureMap({ payload, freshness }: PipelinePressureMapProps) {
  const grouped = new Map<PipelineMetaStage, PipelineStageBucket[]>();
  for (const stage of payload.stages) {
    const list = grouped.get(stage.metaStage) ?? [];
    list.push(stage);
    grouped.set(stage.metaStage, list);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-qep-orange" />
          <h2 className="text-base font-semibold text-foreground">Pipeline Pressure Map</h2>
          <span className="text-[11px] text-muted-foreground">
            {payload.totals.openCount} open · {formatCurrency(payload.totals.openAmount)} ·{" "}
            {formatCurrency(payload.totals.weightedAmount)} weighted
          </span>
        </div>
        {freshness.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness.source}</span>
        )}
      </div>
      {payload.stages.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/40 p-6 text-xs text-muted-foreground">
          No open pipeline in this scope yet.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {META_STAGE_ORDER.map((meta) => {
            const stages = grouped.get(meta) ?? [];
            if (stages.length === 0) return null;
            return (
              <Card key={meta} className="space-y-2 border-border/40 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {META_STAGE_LABEL[meta]}
                  </h3>
                  <span className="text-[10px] text-muted-foreground">{stages.length} stage{stages.length === 1 ? "" : "s"}</span>
                </div>
                <div className="space-y-2">
                  {stages.map((stage) => (
                    <StageRow key={stage.id} stage={stage} />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
