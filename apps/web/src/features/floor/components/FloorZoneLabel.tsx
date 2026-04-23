/**
 * FloorZoneLabel — numbered zone divider used between the Floor's
 * major sections (Narrative · Actions · Floor). Cockpit-style chrome
 * that costs nothing and gives the surface a scannable rhythm.
 *
 * Renders as a thin centered label: "[01 · NARRATIVE]" in Bebas Neue
 * orange caps with short hairlines on either side.
 */
import { cn } from "@/lib/utils";

interface FloorZoneLabelProps {
  index: string;
  label: string;
  className?: string;
}

export function FloorZoneLabel({ index, label, className }: FloorZoneLabelProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center gap-3 px-4 py-1.5",
        className,
      )}
    >
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[hsl(var(--qep-orange))]/40" />
      <span className="font-display text-[10px] tracking-[0.24em] text-[hsl(var(--qep-orange))]/75">
        {index} <span className="text-[hsl(var(--qep-gray))]/50">·</span> {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[hsl(var(--qep-orange))]/40" />
    </div>
  );
}
