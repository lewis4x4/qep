/**
 * Wave 7 Iron Companion v1.10 — inline-SVG sparkline.
 *
 * Tiny component for rendering a per-metric trend below each SLO pill on
 * the FlowAdminPage Iron health card. Pure SVG, no chart library — the
 * SLO card has room for a ~80×24 px sparkline and the point is direction,
 * not exact values (the pill above already shows the live value).
 *
 * Renders a polyline through the normalized values. Last point is dotted
 * so the eye locks onto "where we just were." Stroke color flips to red
 * when the latest point is on the wrong side of the target.
 *
 * Auto-handles:
 *   • Missing data (renders an em-dash placeholder so the layout stays stable)
 *   • Single point (renders a dot)
 *   • All-equal series (renders a flat line at center)
 *   • Inverted metrics (lower-is-better like latency vs higher-is-better
 *     like undo success rate)
 */

interface SloSparklineProps {
  /** Per-snapshot numeric values, oldest → newest. null entries are skipped. */
  values: Array<number | null>;
  /** True = lower is better (latency, dead letter rate, cost escalation pct). */
  lowerIsBetter: boolean;
  /** Target threshold. The line goes red if the most recent value crosses it. */
  target: number;
  width?: number;
  height?: number;
}

export function SloSparkline({
  values,
  lowerIsBetter,
  target,
  width = 96,
  height = 22,
}: SloSparklineProps) {
  const cleanPoints = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null && Number.isFinite(p.v));

  if (cleanPoints.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-muted-foreground/60"
        style={{ width, height }}
      >
        no history yet
      </div>
    );
  }

  // Compute the last value's pass/fail to color the line
  const latestValue = cleanPoints[cleanPoints.length - 1].v;
  const latestPasses = lowerIsBetter ? latestValue <= target : latestValue >= target;
  const strokeColor = latestPasses ? "rgb(52 211 153 / 0.85)" : "rgb(248 113 113 / 0.85)"; // emerald / red
  const fillColor = latestPasses ? "rgb(52 211 153 / 0.10)" : "rgb(248 113 113 / 0.10)";

  // Normalize to viewBox. Include the target line in the y-range so the
  // breach threshold is always visually anchored, not floating off-screen.
  const allYs = [...cleanPoints.map((p) => p.v), target];
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);
  const yRange = maxY - minY || 1; // avoid div by zero on all-equal series

  const padX = 1;
  const padY = 2;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const xStep = cleanPoints.length === 1 ? 0 : innerW / (cleanPoints.length - 1);

  const project = (val: number, idx: number) => {
    // Y axis: invert so higher numeric value = visually higher
    const normalized = (val - minY) / yRange;
    return {
      x: padX + idx * xStep,
      y: padY + (1 - normalized) * innerH,
    };
  };

  const points = cleanPoints.map((p, i) => project(p.v, i));
  const targetY = padY + (1 - (target - minY) / yRange) * innerH;

  // Build the polyline path
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Build a closed area path for the soft fill
  const areaPath =
    points.length > 1
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(height - padY).toFixed(1)} L${points[0].x.toFixed(1)},${(height - padY).toFixed(1)} Z`
      : "";

  const lastPoint = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`SLO trend (${cleanPoints.length} points), latest ${latestPasses ? "passing" : "breaching"}`}
      className="block"
    >
      {/* Target threshold line — dashed neutral */}
      <line
        x1={padX}
        y1={targetY}
        x2={width - padX}
        y2={targetY}
        stroke="rgb(148 163 184 / 0.35)"
        strokeWidth={0.75}
        strokeDasharray="2 2"
      />

      {/* Soft area fill */}
      {areaPath && <path d={areaPath} fill={fillColor} />}

      {/* Trend line */}
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" />

      {/* Latest point — slightly bigger dot so the eye finds "now" */}
      <circle cx={lastPoint.x} cy={lastPoint.y} r={1.75} fill={strokeColor} />
    </svg>
  );
}
