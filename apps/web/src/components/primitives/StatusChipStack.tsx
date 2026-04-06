import { type ReactNode } from "react";

export type ChipTone =
  | "pink" | "orange" | "yellow" | "blue" | "green" | "red" | "purple" | "neutral";

export interface StatusChip {
  label: string;
  tone: ChipTone;
  icon?: ReactNode;
}

interface StatusChipStackProps {
  chips: StatusChip[];
  max?: number;
  className?: string;
}

const TONE_CLASSES: Record<ChipTone, string> = {
  pink:    "bg-pink-500/10 text-pink-400",
  orange:  "bg-qep-orange/10 text-qep-orange",
  yellow:  "bg-amber-500/10 text-amber-400",
  blue:    "bg-blue-500/10 text-blue-400",
  green:   "bg-emerald-500/10 text-emerald-400",
  red:     "bg-red-500/10 text-red-400",
  purple:  "bg-violet-500/10 text-violet-400",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Compact tag-stack used by every list view in the app.
 * Replaces the ad-hoc chip patterns scattered across PipelineDealCard,
 * service rows, parts pages, etc.
 */
export function StatusChipStack({ chips, max, className = "" }: StatusChipStackProps) {
  if (!chips.length) return null;
  const visible = max ? chips.slice(0, max) : chips;
  const overflow = max && chips.length > max ? chips.length - max : 0;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {visible.map((chip, i) => (
        <span
          key={`${chip.label}-${i}`}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${TONE_CLASSES[chip.tone]}`}
        >
          {chip.icon}
          {chip.label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  );
}
