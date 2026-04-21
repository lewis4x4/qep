import { cn } from "@/lib/utils";

export type PulseIntent = "live" | "warming" | "cool" | "cold";

interface PulseSparklineProps {
  /**
   * Numeric samples ordered oldest → newest. Values are normalized to a
   * 0..1 range inside the component so units don't matter.
   * If fewer than 2 points are supplied, the sparkline renders a single
   * pulse bar instead of a line.
   */
  points: number[];
  /**
   * Visual intent:
   *   live    — bright green, pulsing end cap
   *   warming — amber, steady end cap
   *   cool    — muted, static end cap
   *   cold    — red pulse (stale / at risk)
   */
  intent: PulseIntent;
  /** Optional label rendered to the right (e.g. "2d ago"). */
  label?: string;
  /** Width in px. Default 80. */
  width?: number;
  /** Height in px. Default 20. */
  height?: number;
  className?: string;
  "aria-label"?: string;
}

const INTENT_STROKE: Record<PulseIntent, string> = {
  live: "stroke-emerald-500 dark:stroke-emerald-400",
  warming: "stroke-amber-500 dark:stroke-amber-400",
  cool: "stroke-muted-foreground",
  cold: "stroke-red-500 dark:stroke-red-400",
};

const INTENT_DOT: Record<PulseIntent, string> = {
  live: "fill-emerald-500 dark:fill-emerald-400",
  warming: "fill-amber-500 dark:fill-amber-400",
  cool: "fill-muted-foreground",
  cold: "fill-red-500 dark:fill-red-400",
};

const INTENT_LABEL: Record<PulseIntent, string> = {
  live: "text-emerald-700 dark:text-emerald-300",
  warming: "text-amber-700 dark:text-amber-300",
  cool: "text-muted-foreground",
  cold: "text-red-700 dark:text-red-300",
};

/**
 * PulseSparkline — a tiny line chart that communicates activity over time.
 * Replaces the cold "STALE" pill in the QRM header and is reusable across
 * contact/company/deal cards in future slices.
 */
export function PulseSparkline({
  points,
  intent,
  label,
  width = 80,
  height = 20,
  className,
  "aria-label": ariaLabel,
}: PulseSparklineProps) {
  const padding = 2;
  const innerW = Math.max(width - padding * 2, 1);
  const innerH = Math.max(height - padding * 2, 1);
  const pulseAnim = intent === "live" || intent === "cold";

  const computedLabel =
    ariaLabel ??
    (label ? `Pulse ${intent}: ${label}` : `Pulse ${intent}`);

  let path = "";
  let endX = width - padding;
  let endY = height / 2;

  if (points.length >= 2) {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const stepX = innerW / (points.length - 1);
    path = points
      .map((value, index) => {
        const x = padding + index * stepX;
        const y = padding + innerH - ((value - min) / range) * innerH;
        if (index === points.length - 1) {
          endX = x;
          endY = y;
        }
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  } else {
    const fallback = points[0] ?? 0.5;
    const y = padding + innerH - Math.min(Math.max(fallback, 0), 1) * innerH;
    path = `M${padding},${y.toFixed(2)} L${width - padding},${y.toFixed(2)}`;
    endY = y;
  }

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={computedLabel}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0"
        aria-hidden="true"
      >
        <path
          d={path}
          className={cn("fill-none", INTENT_STROKE[intent])}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={endX}
          cy={endY}
          r={2.25}
          className={cn(INTENT_DOT[intent], pulseAnim && "animate-pulse")}
        />
      </svg>
      {label && (
        <span
          className={cn(
            "text-[11px] font-medium uppercase tracking-wide whitespace-nowrap",
            INTENT_LABEL[intent]
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * Derive a visual intent + human label from a last-sync timestamp.
 * Thresholds (hours):
 *   <= 24  → live
 *   <= 72  → warming
 *   <= 168 → cool
 *   > 168  → cold
 */
export function pulseFromLastSync(
  lastSyncAt: string | Date | null | undefined,
  now: Date = new Date(),
): { intent: PulseIntent; label: string; hoursAgo: number | null } {
  if (!lastSyncAt) {
    return { intent: "cold", label: "no sync", hoursAgo: null };
  }
  const ts = typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt;
  const hoursAgo = (now.getTime() - ts.getTime()) / (1000 * 60 * 60);

  if (!Number.isFinite(hoursAgo) || hoursAgo < 0) {
    return { intent: "live", label: "just now", hoursAgo: 0 };
  }

  if (hoursAgo <= 24) {
    return { intent: "live", label: formatAge(hoursAgo), hoursAgo };
  }
  if (hoursAgo <= 72) {
    return { intent: "warming", label: formatAge(hoursAgo), hoursAgo };
  }
  if (hoursAgo <= 168) {
    return { intent: "cool", label: formatAge(hoursAgo), hoursAgo };
  }
  return { intent: "cold", label: formatAge(hoursAgo), hoursAgo };
}

function formatAge(hoursAgo: number): string {
  if (hoursAgo < 1) return "just now";
  if (hoursAgo < 24) return `${Math.round(hoursAgo)}h ago`;
  const days = Math.round(hoursAgo / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/**
 * Synthesize a 7-point sparkline from a single lastSyncAt so we can render
 * *something* meaningful today, before we have real historical touch data
 * (Slice 3 will back this with the signals stream).
 */
export function synthesizeSyncPulsePoints(
  lastSyncAt: string | Date | null | undefined,
  now: Date = new Date(),
): number[] {
  if (!lastSyncAt) return [0.2, 0.18, 0.2, 0.17, 0.19, 0.18, 0.2];
  const ts = typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt;
  const hoursAgo = Math.max(0, (now.getTime() - ts.getTime()) / (1000 * 60 * 60));
  // Slope: fresher = climbing end, stale = declining end.
  const freshness = Math.max(0, Math.min(1, 1 - hoursAgo / (24 * 14)));
  const base = 0.3 + freshness * 0.6;
  const jitter = (i: number) => 0.08 * Math.sin(i * 1.3 + freshness * 3);
  return Array.from({ length: 7 }, (_, i) => {
    const trend = base * (0.7 + (i / 6) * 0.3);
    return Math.max(0.05, Math.min(1, trend + jitter(i)));
  });
}
