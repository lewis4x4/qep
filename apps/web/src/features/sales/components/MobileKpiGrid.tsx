import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MobileKpiItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  icon?: ReactNode;
  /** Optional tint applied to the value text. */
  tone?: "default" | "positive" | "warning" | "danger" | "orange";
  /** Optional onClick to make the tile interactive. */
  onClick?: () => void;
}

export interface MobileKpiGridProps {
  items: MobileKpiItem[];
  /**
   * Tile columns on phone-sized viewports.
   *
   * Defaults to 2 (the standard 2x2 KPI quad). Pass 3 for compact
   * status strips (e.g. the Pricing margin strip: Margin / Net /
   * Floor) where three short values need to share a single row.
   */
  phoneColumns?: 2 | 3;
  /** Tile columns on >= sm viewports. Defaults to 4. */
  smColumns?: 3 | 4;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<MobileKpiItem["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-red-300",
  orange: "text-qep-orange",
};

/**
 * 2-col KPI strip on phones, expands to 3/4-col on >= sm. Each tile uses
 * MOBILE.surface.card and respects the 44pt min touch target.
 */
export function MobileKpiGrid({
  items,
  phoneColumns = 2,
  smColumns = 4,
  className,
}: MobileKpiGridProps) {
  return (
    <div
      className={cn(
        "grid gap-2",
        phoneColumns === 3 ? "grid-cols-3" : "grid-cols-2",
        smColumns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4",
        className,
      )}
      data-testid="mobile-kpi-grid"
    >
      {items.map((item) => {
        const tone = item.tone ?? "default";
        const interactive = typeof item.onClick === "function";
        const TileTag = interactive ? "button" : "div";
        return (
          <TileTag
            key={item.id}
            type={interactive ? "button" : undefined}
            onClick={item.onClick}
            className={cn(
              "rounded-2xl border border-white/[0.06] bg-foreground/[0.04] px-3 py-3 min-h-[88px] text-left flex flex-col justify-between",
              interactive && "hover:border-white/20 active:scale-[0.98] transition-all",
            )}
            data-kpi-id={item.id}
          >
            <div className="flex items-center gap-1.5">
              {item.icon && (
                <span className="text-muted-foreground shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                  {item.icon}
                </span>
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                {item.label}
              </span>
            </div>
            <div
              className={cn(
                "text-xl font-bold tracking-tight mt-1 leading-tight",
                TONE_CLASS[tone],
              )}
            >
              {item.value}
            </div>
            {item.caption && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {item.caption}
              </div>
            )}
          </TileTag>
        );
      })}
    </div>
  );
}
