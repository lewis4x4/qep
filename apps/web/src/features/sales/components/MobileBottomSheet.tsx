import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sheet header title. Render-only — no controls. */
  title?: ReactNode;
  /** Optional sub-title under the title. */
  description?: ReactNode;
  /** Sheet body. */
  children: ReactNode;
  /** Tall (~92vh) vs medium (~60vh). Defaults to medium. */
  size?: "medium" | "tall";
  /** Optional className passthrough on the panel. */
  className?: string;
}

/**
 * Generic mobile bottom sheet used for right-rail panel surfacing
 * (AI Recommendation, Deal Coach, Financing Preview, Customer Intel,
 * What to Mention, Match to Deal, etc.) on phone-sized viewports.
 *
 * Uses CSS transforms — no framer-motion dependency needed.
 */
export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "medium",
  className,
}: MobileBottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Trap escape key to close
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-50 transition-opacity duration-200",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      data-testid="mobile-bottom-sheet-root"
      data-open={open ? "true" : "false"}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close sheet"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/50"
        tabIndex={open ? 0 : -1}
        data-testid="mobile-bottom-sheet-backdrop"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "absolute bottom-0 left-0 right-0 max-w-lg mx-auto rounded-t-2xl border-t border-white/[0.08] bg-[hsl(var(--card))]",
          "transition-transform duration-300 ease-out flex flex-col",
          size === "tall" ? "max-h-[92vh]" : "max-h-[60vh]",
          open ? "translate-y-0" : "translate-y-full",
          className,
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        data-testid="mobile-bottom-sheet-panel"
        data-mobile-sheet="true"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1.5 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/[0.12]" aria-hidden />
        </div>

        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between px-5 pb-3 pt-1 shrink-0">
            <div className="min-w-0">
              {title && (
                <h2 className="text-lg font-semibold text-foreground tracking-tight">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="ml-3 w-9 h-9 rounded-lg border border-white/[0.06] bg-foreground/[0.04] flex items-center justify-center hover:border-white/20 transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" aria-hidden />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}
