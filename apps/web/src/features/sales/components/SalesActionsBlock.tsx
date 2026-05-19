import { Link } from "react-router-dom";
import {
  ArrowRight,
  FileText,
  Mic,
  Target,
  Activity,
  AlertTriangle,
} from "lucide-react";
import type { RepPipelineDeal, PipelineStats } from "../lib/types";
import { pickSalesPrimaryAction } from "../lib/sales-primary-action";

export interface SalesActionsBlockProps {
  pipeline: RepPipelineDeal[];
  liveStats: PipelineStats;
  /** Drives the voice secondary action — opens the LogVisit sheet. */
  onVoiceQuote: () => void;
}

const TODAY_MS = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();
const TOMORROW_MS = TODAY_MS + 24 * 60 * 60 * 1000;

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function computeFollowUpStats(pipeline: RepPipelineDeal[]): {
  dueToday: number;
  overdue: number;
  tiedUp: number;
  stalest: { customer: string; days: number } | null;
} {
  let dueToday = 0;
  let overdue = 0;
  let tiedUp = 0;
  let stalest: { customer: string; days: number } | null = null;
  for (const deal of pipeline) {
    if (!deal.next_follow_up_at) continue;
    const ms = new Date(deal.next_follow_up_at).getTime();
    if (Number.isNaN(ms)) continue;
    tiedUp += deal.amount ?? 0;
    if (ms < TODAY_MS) {
      overdue += 1;
      const days = Math.floor((Date.now() - ms) / 86_400_000);
      if (!stalest || days > stalest.days) {
        stalest = { customer: deal.customer_name, days };
      }
    } else if (ms < TOMORROW_MS) {
      dueToday += 1;
    }
  }
  return { dueToday, overdue, tiedUp, stalest };
}

function computeDecisionStageCount(pipeline: RepPipelineDeal[]): number {
  return pipeline.filter((deal) =>
    /(decision|negotiat|proposal|quote)/i.test(deal.stage ?? ""),
  ).length;
}

export function SalesActionsBlock({
  pipeline,
  liveStats,
  onVoiceQuote,
}: SalesActionsBlockProps) {
  const primary = pickSalesPrimaryAction(pipeline);
  const followUps = computeFollowUpStats(pipeline);
  const decisionCount = computeDecisionStageCount(pipeline);
  const followUpHero = followUps.dueToday + followUps.overdue;
  const followUpUrgency =
    followUps.overdue > 0
      ? `${followUps.overdue} overdue · ${followUps.dueToday} due today`
      : followUps.dueToday > 0
        ? `${followUps.dueToday} due today`
        : "Caught up — no touchpoints due";

  return (
    <section data-testid="sales-actions-block" className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-qep-orange">
          02 Actions
        </p>
        <div className="flex-1 h-px bg-white/[0.06]" />
      </div>

      {/* Primary — context-aware hero. Card is a div (not a button) so the
          inner Voice button isn't nested inside another button. */}
      <div
        data-testid="sales-primary-action"
        data-kind={primary.kind}
        className="relative overflow-hidden rounded-3xl border border-qep-orange/60 p-5"
        style={{
          background:
            "linear-gradient(135deg, #E87722 0%, #C66318 55%, #1b0e04 100%)",
          boxShadow:
            "0 16px 48px rgba(232,119,34,0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/[0.12] blur-[40px]" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
              <FileText className="h-3 w-3" />
              Quote Builder
            </span>
            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#1b0e04]">
              Primary
            </span>
          </div>

          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85">
            Start here
          </p>
          <h2 className="mt-1 text-2xl font-extrabold leading-tight tracking-tight text-white">
            {primary.label}
          </h2>
          <p className="mt-2 text-sm font-medium leading-relaxed text-white/90">
            {primary.reason}
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              to={primary.to}
              aria-label={primary.label}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b0e04] shadow-lg active:scale-95 transition-transform"
            >
              Go
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={onVoiceQuote}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/45 bg-black/40 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white active:scale-95"
            >
              <Mic className="h-3.5 w-3.5" />
              Voice quote
            </button>
          </div>
        </div>
      </div>

      {/* Secondary tiles */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/sales/pipeline?filter=follow_ups"
          aria-label="Today's follow-ups"
          className="group relative flex min-h-[160px] flex-col gap-1.5 overflow-hidden rounded-2xl border border-qep-orange/30 bg-qep-orange/[0.08] p-4 transition-all hover:border-qep-orange/55 hover:bg-qep-orange/[0.12]"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-qep-orange text-[#1b0e04]">
                <Target className="h-3.5 w-3.5" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-qep-orange">
                Follow-ups
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-qep-orange transition-transform group-hover:translate-x-0.5" />
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-extrabold leading-none tabular-nums text-foreground">
              {followUpHero}
            </span>
            {followUps.tiedUp > 0 && (
              <span className="pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-qep-orange">
                {formatCompactUsd(followUps.tiedUp)} tied up
              </span>
            )}
          </div>
          <p className="text-[11px] text-foreground/80">{followUpUrgency}</p>
          {followUps.stalest && (
            <p className="mt-auto inline-flex items-center gap-1 text-[10px] text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {followUps.stalest.customer} · {followUps.stalest.days}d stale
            </p>
          )}
        </Link>

        <Link
          to="/sales/pipeline"
          aria-label="My pipeline"
          className="group flex min-h-[160px] flex-col gap-1.5 overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(var(--card))] p-4 transition-all hover:border-white/[0.18]"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/30 text-foreground/80">
                <Activity className="h-3.5 w-3.5" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Pipeline
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-extrabold leading-none tabular-nums text-foreground">
              {liveStats.deals_in_pipeline}
            </span>
            <span className="pb-0.5 text-[10px] font-semibold text-muted-foreground">
              deals
            </span>
          </div>
          <p className="text-sm font-extrabold text-qep-orange">
            {formatCompactUsd(liveStats.total_pipeline_value)}{" "}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              open
            </span>
          </p>
          <p className="mt-auto text-[10px] text-amber-400">
            {decisionCount > 0
              ? `${decisionCount} at decision stage`
              : "No decision-stage pressure"}
          </p>
        </Link>
      </div>
    </section>
  );
}
