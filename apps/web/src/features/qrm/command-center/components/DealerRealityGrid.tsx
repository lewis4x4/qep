/**
 * Dealer Reality Grid — Track 1, Slice 1.2.
 *
 * 6-tile operational radar showing every domain of the dealership at a glance.
 * Each tile is a living signal with urgency, momentum, and a one-tap action path.
 * Unavailable domains render honestly — muted, not hidden.
 *
 * Uses framer-motion for staggered cascade reveal + subtle hover interactions.
 * GlassPanel-inspired glassmorphic tiles match the moonshot design language.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  FileText,
  Gauge,
  GitCompare,
  MonitorPlay,
  Truck,
  Key,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type {
  DealerGridTile,
  DealerGridTileKey,
  DealerRealityGridPayload,
  SectionFreshness,
} from "../api/commandCenter.types";

// ─── Constants ─────────────────────────────────────────────────────────────

const TILE_ICONS: Record<DealerGridTileKey, LucideIcon> = {
  quotes: FileText,
  trades: GitCompare,
  demos: MonitorPlay,
  traffic: Truck,
  rentals: Key,
  escalations: ShieldAlert,
};

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  if (amount > 0) return `$${Math.round(amount)}`;
  return "";
}

function tileUrgencyTone(tile: DealerGridTile): string {
  if (tile.status === "degraded" || tile.status === "unavailable") {
    return "border-white/[0.04] bg-white/[0.01] opacity-50";
  }
  if (tile.urgentCount >= 3) return "border-rose-500/20 bg-rose-500/[0.03]";
  if (tile.urgentCount >= 1) return "border-amber-500/20 bg-amber-500/[0.03]";
  return "border-white/[0.06] bg-white/[0.02]";
}

// ─── Animation variants ────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const tileVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
};

// ─── Tile sub-component ────────────────────────────────────────────────────

function DealerGridTileCard({ tile }: { tile: DealerGridTile }) {
  const Icon = TILE_ICONS[tile.key];
  const isDegraded = tile.status === "degraded" || tile.status === "unavailable";
  const valueLabel = tile.totalValue > 0 ? formatCurrency(tile.totalValue) : null;

  return (
    <motion.div
      variants={tileVariants}
      whileHover={isDegraded ? undefined : { scale: 1.01, y: -2 }}
      whileTap={isDegraded ? undefined : { scale: 0.99 }}
      className={cn(
        "group relative flex flex-col justify-between rounded-2xl border p-4 transition-colors duration-200",
        "min-h-[180px]",
        tileUrgencyTone(tile),
        !isDegraded && "hover:border-qep-orange/30 hover:bg-white/[0.04]",
        isDegraded && "border-dashed",
      )}
    >
      {/* Header: icon + label + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", isDegraded ? "text-white/30" : "text-qep-orange")} />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
            {tile.label}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0",
            tile.status === "live" && "border-emerald-500/30 text-emerald-400",
            tile.status === "degraded" && "border-amber-500/30 text-amber-400",
            tile.status === "unavailable" && "border-white/10 text-white/30",
          )}
        >
          {tile.status}
        </Badge>
      </div>

      {/* Body: counts + value + summary + movement */}
      <div className="mt-3 flex-1 space-y-1.5">
        {/* Active count — hero number */}
        <div className="flex items-baseline gap-2">
          <span className={cn(
            "text-3xl font-semibold tabular-nums",
            isDegraded ? "text-white/20" : "text-white",
          )}>
            {tile.activeCount}
          </span>
          {tile.urgentCount > 0 && !isDegraded && (
            <span className={cn(
              "text-xs font-medium",
              tile.urgentCount >= 3 ? "text-rose-400" : "text-amber-400",
            )}>
              {tile.urgentCount} urgent
            </span>
          )}
        </div>

        {/* Dollar exposure */}
        {valueLabel && !isDegraded && (
          <p className="text-xs font-medium tabular-nums text-white/60">
            {valueLabel} exposure
          </p>
        )}

        {/* Summary */}
        <p className={cn(
          "text-[11px] leading-relaxed",
          isDegraded ? "text-white/25" : "text-slate-400",
        )}>
          {isDegraded && tile.reason ? tile.reason : tile.summary}
        </p>

        {/* Movement indicator */}
        {tile.movement && !isDegraded && (
          <p className={cn(
            "text-[11px] font-medium",
            tile.movement.startsWith("\u2191") ? "text-emerald-400" : "text-rose-400",
          )}>
            {tile.movement}
          </p>
        )}
      </div>

      {/* CTA */}
      <div className="mt-3 pt-2 border-t border-white/[0.06]">
        <Link
          to={tile.ctaHref}
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors min-h-[44px] min-w-[44px]",
            isDegraded
              ? "text-white/25 pointer-events-none"
              : "text-qep-orange hover:text-qep-orange/80",
          )}
        >
          {tile.ctaLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

interface DealerRealityGridProps {
  payload: DealerRealityGridPayload;
  freshness: SectionFreshness;
}

export function DealerRealityGrid({ payload, freshness }: DealerRealityGridProps) {
  // Guard: backend may not yet return this section
  if (!payload) return null;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold tracking-tight text-white">Dealer Reality</h3>
          <span className="text-[10px] text-slate-500">
            {payload.tiles.filter((t) => t.status === "live").length} of {payload.tiles.length} live
          </span>
        </div>
        {freshness?.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness?.source}</span>
        )}
      </div>

      {/* 6-tile grid with staggered cascade */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        {payload.tiles.map((tile) => (
          <DealerGridTileCard key={tile.key} tile={tile} />
        ))}
      </motion.div>
    </div>
  );
}
