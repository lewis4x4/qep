/**
 * Executive Intelligence Layer v1 — Track 1, Slice 1.8 (FINAL).
 *
 * Manager/owner-gated section showing the four signals leadership needs
 * to run the business: forecast confidence, rep performance, margin
 * pressure, and branch health.
 *
 * Read-only in Track 1. Full interactive version ships in Track 5.
 */

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { cn } from "@/lib/utils";
import {
  Crown,
  Gauge,
  Scale,
  MapPin,
  TrendingUp,
  Users,
} from "lucide-react";
import type {
  ExecutiveIntelPayload,
  ForecastConfidenceCard,
  RepPerformanceCard,
  MarginPressureCard,
  BranchHealthCard,
  SectionFreshness,
} from "../api/commandCenter.types";

// ─── Helpers ───────────────────────────────────────────────────────────────

import { formatCurrency } from "@/lib/format";

const listVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" as const } },
};

// ─── Forecast Confidence Card ──────────────────────────────────────────────

function ForecastCard({ forecast }: { forecast: ForecastConfidenceCard }) {
  const scoreColor = forecast.confidenceLabel === "Strong"
    ? "text-emerald-400" : forecast.confidenceLabel === "Moderate"
      ? "text-amber-400" : "text-rose-400";
  const scoreBorder = forecast.confidenceLabel === "Strong"
    ? "border-emerald-500/20" : forecast.confidenceLabel === "Moderate"
      ? "border-amber-500/20" : "border-rose-500/20";
  const scoreBg = forecast.confidenceLabel === "Strong"
    ? "bg-emerald-500" : forecast.confidenceLabel === "Moderate"
      ? "bg-amber-500" : "bg-rose-500";

  return (
    <GlassPanel className={cn("p-5 space-y-3", scoreBorder)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-qep-orange" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Forecast Confidence</span>
        </div>
        <Badge variant="outline" className={cn("text-[9px] font-bold uppercase tracking-wider px-2", scoreBorder, scoreColor)}>
          {forecast.confidenceLabel}
        </Badge>
      </div>

      {/* Confidence score bar */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className={cn("text-3xl font-semibold tabular-nums", scoreColor)}>{forecast.confidenceScore}</span>
          <span className="text-[11px] text-slate-500">/ 100</span>
        </div>
        <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", scoreBg)} style={{ width: `${forecast.confidenceScore}%` }} />
        </div>
      </div>

      {/* Pipeline metrics */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-slate-500">Weighted Pipeline</span>
          <p className="text-sm font-medium tabular-nums text-white">{formatCurrency(forecast.weightedPipeline)}</p>
        </div>
        <div>
          <span className="text-slate-500">Raw Pipeline</span>
          <p className="text-sm font-medium tabular-nums text-white/70">{formatCurrency(forecast.rawPipeline)}</p>
        </div>
        <div>
          <span className="text-slate-500">Active Deals</span>
          <p className="text-sm font-medium tabular-nums text-white">{forecast.activeDeals}</p>
        </div>
        <div>
          <span className="text-slate-500">Avg Gap</span>
          <p className={cn("text-sm font-medium tabular-nums", forecast.avgInactivityDays > 10 ? "text-amber-400" : "text-white/70")}>
            {forecast.avgInactivityDays}d
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}

// ─── Margin Pressure Card ──────────────────────────────────────────────────

function MarginCard({ margin }: { margin: MarginPressureCard }) {
  const hasIssues = margin.flaggedDealCount > 0 || margin.negativeMarginCloses30d > 0;
  return (
    <GlassPanel className={cn("p-5 space-y-3", hasIssues ? "border-amber-500/20" : "border-white/[0.06]")}>
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-amber-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Margin Pressure</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <span className="text-slate-500">Flagged Deals</span>
          <p className={cn("text-xl font-semibold tabular-nums", margin.flaggedDealCount > 0 ? "text-amber-400" : "text-white/50")}>
            {margin.flaggedDealCount}
          </p>
          {margin.flaggedDealValue > 0 && (
            <p className="text-[11px] tabular-nums text-amber-400/70">{formatCurrency(margin.flaggedDealValue)}</p>
          )}
        </div>
        <div>
          <span className="text-slate-500">Negative Closes (30d)</span>
          <p className={cn("text-xl font-semibold tabular-nums", margin.negativeMarginCloses30d > 0 ? "text-rose-400" : "text-white/50")}>
            {margin.negativeMarginCloses30d}
          </p>
          {margin.medianMarginPct30d !== null && (
            <p className="text-[11px] text-slate-500">Median: {margin.medianMarginPct30d}%</p>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

// ─── Rep Performance Card ──────────────────────────────────────────────────

function RepPerfCard({ reps }: { reps: RepPerformanceCard[] }) {
  return (
    <GlassPanel className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-blue-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Top Rep Performance (7d)</span>
      </div>

      {reps.length === 0 ? (
        <p className="text-[11px] text-slate-500">No prospecting data available</p>
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-1.5">
          {reps.map((rep) => (
            <motion.div
              key={rep.repId}
              variants={itemVariants}
              className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2"
            >
              <div>
                <span className="text-sm font-medium text-white">{rep.repName}</span>
                {rep.targetMetStreak > 0 && (
                  <span className="ml-2 text-[10px] text-emerald-400">{rep.targetMetStreak}d streak</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] tabular-nums">
                <span className="text-white/70">{rep.visits7d} visits</span>
                <span className="text-slate-500">{rep.opportunitiesCreated} opps</span>
                <span className="text-slate-500">{rep.quotesGenerated} quotes</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </GlassPanel>
  );
}

// ─── Branch Health Card ────────────────────────────────────────────────────

function BranchCard({ branches }: { branches: BranchHealthCard[] }) {
  return (
    <GlassPanel className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-violet-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Branch Health</span>
      </div>

      {branches.length === 0 ? (
        <p className="text-[11px] text-slate-500">No branch data available</p>
      ) : (
        <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-1.5">
          {branches.map((branch) => (
            <motion.div
              key={branch.branchId}
              variants={itemVariants}
              className="flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2"
            >
              <span className="text-sm font-medium text-white">{branch.branchName}</span>
              <div className="flex items-center gap-3 text-[11px] tabular-nums">
                {branch.pipelineValue > 0 && <span className="text-white/70">{formatCurrency(branch.pipelineValue)}</span>}
                {branch.dealCount > 0 && <span className="text-slate-500">{branch.dealCount} deals</span>}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </GlassPanel>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

interface ExecutiveIntelLayerProps {
  payload: ExecutiveIntelPayload;
  freshness: SectionFreshness;
}

export function ExecutiveIntelLayer({ payload, freshness }: ExecutiveIntelLayerProps) {
  if (!payload || !payload.isElevatedView) return null;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold tracking-tight text-white">Executive Intelligence</h3>
          <Badge variant="outline" className="text-[9px] border-qep-orange/30 text-qep-orange px-1.5">Elevated</Badge>
          <span className="text-[10px] text-slate-500">v1 preview</span>
        </div>
        {freshness?.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness?.source}</span>
        )}
      </div>

      {/* 2x2 intelligence grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ForecastCard forecast={payload.forecast} />
        <MarginCard margin={payload.marginPressure} />
        <RepPerfCard reps={payload.topReps} />
        <BranchCard branches={payload.branchHealth} />
      </div>
    </div>
  );
}
