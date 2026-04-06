export type CountdownTone = "blue" | "green" | "yellow" | "orange" | "red" | "neutral";

interface CountdownBarProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  tone?: CountdownTone;
  /** Show inverse semantics: progress is "consumed", not "remaining". */
  inverse?: boolean;
  className?: string;
}

const TONE: Record<CountdownTone, { fill: string; text: string }> = {
  blue:    { fill: "bg-blue-400",     text: "text-blue-400" },
  green:   { fill: "bg-emerald-400",  text: "text-emerald-400" },
  yellow:  { fill: "bg-amber-400",    text: "text-amber-400" },
  orange:  { fill: "bg-qep-orange",   text: "text-qep-orange" },
  red:     { fill: "bg-red-400",      text: "text-red-400" },
  neutral: { fill: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

/**
 * Single horizontal progress bar with right-aligned remaining label.
 * The atomic unit T3 stacks for service intervals, and the building
 * block for AssetCountdownStack.
 */
export function CountdownBar({
  label, current, target, unit, tone = "blue", inverse = false, className = "",
}: CountdownBarProps) {
  const pct = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;
  const remaining = Math.max(0, target - current);
  const fillPct = inverse ? 100 - pct : pct;
  const t = TONE[tone];

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-[10px]">
        <span className="font-medium text-foreground truncate">{label}</span>
        <span className={`tabular-nums ${t.text}`}>
          {remaining.toLocaleString()} {unit} left
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${t.fill} transition-all`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
    </div>
  );
}
