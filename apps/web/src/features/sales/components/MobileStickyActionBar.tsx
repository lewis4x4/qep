import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MobileStickyActionBarProps {
  /**
   * Optional left-side secondary action (e.g. "Save Draft", "Re-record").
   * Rendered with its natural width.
   */
  secondary?: ReactNode;
  /**
   * Primary action node. Fills the remaining horizontal space and is the
   * dominant element of the bar.
   */
  primary: ReactNode;
  /**
   * Optional thin progress line rendered immediately above the bar.
   * Value should be between 0 and 1.
   */
  progress?: number;
  /** Optional className passthrough on the outer container. */
  className?: string;
}

/**
 * Fixed bottom action bar sitting immediately above the BottomTabBar
 * (`bottom-16`) and inside the safe-area inset. Use on every rep-facing
 * page that exposes a primary forward action (Continue, Save & Sync,
 * Send Quote, Update Stage, etc.).
 */
export function MobileStickyActionBar({
  secondary,
  primary,
  progress,
  className,
}: MobileStickyActionBarProps) {
  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-30 pointer-events-none",
        "bottom-16", // clear BottomTabBar (64px)
        className,
      )}
      data-testid="mobile-sticky-action-bar"
    >
      {typeof progress === "number" && (() => {
        const clamped = Math.min(Math.max(progress, 0), 1);
        return (
          <div
            className="h-1 bg-foreground/[0.06]"
            role="progressbar"
            aria-valuenow={Math.round(clamped * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Wizard progress"
          >
            <div
              className="h-full bg-qep-orange transition-all duration-300"
              style={{ width: `${clamped * 100}%` }}
            />
          </div>
        );
      })()}
      <div
        className="pointer-events-auto bg-[hsl(var(--card))]/95 backdrop-blur-md border-t border-white/[0.06]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto min-h-[64px]">
          {secondary && <div className="shrink-0">{secondary}</div>}
          <div className="flex-1 min-w-0">{primary}</div>
        </div>
      </div>
    </div>
  );
}
