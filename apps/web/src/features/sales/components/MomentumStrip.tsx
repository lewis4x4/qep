import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";

export interface MomentumStripProps {
  pipeline: RepPipelineDeal[];
  quotesThisWeek: number;
}

interface Tile {
  label: string;
  value: string;
  trend: "up" | "down" | "flat" | "none";
  hint?: string;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

export function MomentumStrip({
  pipeline,
  quotesThisWeek,
}: MomentumStripProps) {
  const totalValue = pipeline.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const warmCount = pipeline.filter((d) => d.heat_status === "warm").length;
  const coolingCount = pipeline.filter(
    (d) => d.heat_status === "cooling" || d.heat_status === "cold",
  ).length;

  const pipelineTrend: Tile["trend"] =
    pipeline.length === 0 ? "none" : warmCount > coolingCount ? "up" : coolingCount > warmCount ? "down" : "flat";

  const tiles: Tile[] = [
    {
      label: "Pipeline",
      value: pipeline.length === 0 ? "Day 1" : formatCurrency(totalValue),
      trend: pipelineTrend,
      hint:
        pipeline.length === 0
          ? "no deals yet"
          : `${pipeline.length} ${pipeline.length === 1 ? "deal" : "deals"}`,
    },
    {
      label: "Warm",
      value: pipeline.length === 0 ? "—" : `${warmCount}`,
      trend: warmCount > 0 ? "up" : "none",
      hint:
        coolingCount > 0
          ? `${coolingCount} cooling`
          : pipeline.length === 0
            ? "log a touch"
            : "all engaged",
    },
    {
      label: "Quotes",
      value: quotesThisWeek > 0 ? `${quotesThisWeek}` : "—",
      trend: quotesThisWeek > 0 ? "up" : "none",
      hint: "this week",
    },
  ];

  return (
    <div
      data-testid="momentum-strip"
      className="bg-[hsl(var(--card))] rounded-xl border border-white/[0.08] px-3 py-3 grid grid-cols-3 gap-2"
    >
      {tiles.map((tile, i) => (
        <TileView key={i} tile={tile} />
      ))}
    </div>
  );
}

function TileView({ tile }: { tile: Tile }) {
  const trendColor =
    tile.trend === "up"
      ? "text-emerald-400"
      : tile.trend === "down"
        ? "text-amber-400"
        : "text-muted-foreground/50";

  const TrendIcon =
    tile.trend === "up"
      ? ArrowUpRight
      : tile.trend === "down"
        ? ArrowDownRight
        : tile.trend === "flat"
          ? Minus
          : null;

  return (
    <div className="text-center px-1">
      <div className="flex items-baseline justify-center gap-1">
        <p className="text-[20px] font-extrabold tracking-tight text-foreground">
          {tile.value}
        </p>
        {TrendIcon && (
          <TrendIcon
            className={`w-3.5 h-3.5 ${trendColor}`}
            aria-hidden="true"
          />
        )}
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mt-0.5">
        {tile.label}
      </p>
      {tile.hint && (
        <p className="text-[10px] text-muted-foreground/60 truncate">
          {tile.hint}
        </p>
      )}
    </div>
  );
}
