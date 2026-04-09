/**
 * Relationship & Opportunity Engine — Track 1, Slice 1.6.
 *
 * 5-stream signal feed showing relationship momentum across the
 * dealership's account base: heating up, cooling off, competitor rising,
 * fleet replacement, silent key accounts.
 *
 * Each stream is color-coded and limited to top 5 signals by relevance.
 * Empty streams are hidden. Entire section returns null if no data.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Flame,
  GitCompare,
  Link2,
  Snowflake,
  Swords,
  RefreshCcw,
  VolumeX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  RelationshipEnginePayload,
  RelationshipSignal,
  RelationshipSignalKind,
  SectionFreshness,
} from "../api/commandCenter.types";

// ─── Stream config ─────────────────────────────────────────────────────────

interface StreamConfig {
  icon: LucideIcon;
  label: string;
  color: string;
  bg: string;
  border: string;
}

const STREAM_CONFIG: Record<RelationshipSignalKind, StreamConfig> = {
  heating_up: { icon: Flame, label: "Heating Up", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  cooling_off: { icon: Snowflake, label: "Cooling Off", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20" },
  competitor_rising: { icon: Swords, label: "Competitor Rising", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  fleet_replacement: { icon: RefreshCcw, label: "Fleet Replacement", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  silent_key_account: { icon: VolumeX, label: "Silent Key Accounts", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" },
};

// ─── Animation ─────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.25, ease: "easeOut" as const } },
};

// ─── Signal card ───────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: RelationshipSignal }) {
  const config = STREAM_CONFIG[signal.kind];

  return (
    <motion.div
      variants={itemVariants}
      className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04] hover:border-qep-orange/20"
    >
      <div className="flex-1 min-w-0">
        <Link
          to={signal.ctaHref}
          className="text-sm font-medium text-white hover:text-qep-orange transition-colors"
        >
          {signal.companyName}
        </Link>
        <p className="text-[11px] text-slate-400 mt-0.5 truncate">{signal.detail}</p>
      </div>
      <Link
        to={signal.ctaHref}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-qep-orange transition-colors min-h-[44px] shrink-0"
      >
        {signal.ctaLabel} <ArrowRight className="h-3 w-3" />
      </Link>
    </motion.div>
  );
}

// ─── Signal stream ─────────────────────────────────────────────────────────

function SignalStream({ kind, signals }: { kind: RelationshipSignalKind; signals: RelationshipSignal[] }) {
  if (signals.length === 0) return null;
  const config = STREAM_CONFIG[kind];
  const Icon = config.icon;

  return (
    <div className="space-y-2">
      {/* Stream header */}
      <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", config.border, config.bg)}>
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
        <span className={cn("text-[10px] font-bold uppercase tracking-[0.18em]", config.color)}>
          {config.label}
        </span>
        <Badge variant="outline" className={cn("text-[9px] px-1.5", config.border, config.color)}>
          {signals.length}
        </Badge>
      </div>

      {/* Signal cards */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-1.5">
        {signals.map((signal) => (
          <SignalCard key={`${signal.kind}-${signal.companyId}`} signal={signal} />
        ))}
      </motion.div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

interface RelationshipEngineProps {
  payload: RelationshipEnginePayload;
  freshness: SectionFreshness;
}

export function RelationshipEngine({ payload, freshness }: RelationshipEngineProps) {
  // Guard: backend may not yet return this section
  if (!payload) return null;

  const streams: Array<{ kind: RelationshipSignalKind; signals: RelationshipSignal[] }> = [
    { kind: "heating_up", signals: payload.heatingUp ?? [] },
    { kind: "cooling_off", signals: payload.coolingOff ?? [] },
    { kind: "competitor_rising", signals: payload.competitorRising ?? [] },
    { kind: "fleet_replacement", signals: payload.fleetReplacement ?? [] },
    { kind: "silent_key_account", signals: payload.silentKeyAccounts ?? [] },
  ];

  const totalSignals = streams.reduce((sum, s) => sum + s.signals.length, 0);

  // If no signals at all, don't render the section
  if (totalSignals === 0) return null;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold tracking-tight text-white">Relationship & Opportunity Engine</h3>
          <span className="text-[10px] text-slate-500">{totalSignals} signal{totalSignals !== 1 ? "s" : ""}</span>
        </div>
        {freshness?.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness?.source}</span>
        )}
      </div>

      {/* Signal streams (empty ones auto-hidden) */}
      <div className="space-y-4">
        {streams.map((stream) => (
          <SignalStream key={stream.kind} kind={stream.kind} signals={stream.signals} />
        ))}
      </div>
    </div>
  );
}
