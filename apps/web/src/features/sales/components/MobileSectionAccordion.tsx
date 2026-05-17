import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileSectionAccordionProps {
  /** Sequential index — rendered as 01, 02... matching FloorPage style. */
  index: number;
  title: ReactNode;
  /** Optional one-line caption rendered under the title. */
  caption?: ReactNode;
  /** Optional right-aligned chip (e.g. count badge). */
  trailing?: ReactNode;
  /** Initial expansion state. Defaults to true. */
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

/**
 * Collapsible numbered section primitive matching the
 * FloorPage "01 Narrative / 02 Actions" pattern.
 */
export function MobileSectionAccordion({
  index,
  title,
  caption,
  trailing,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
}: MobileSectionAccordionProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const bodyId = useId();
  const formatted = String(index).padStart(2, "0");

  return (
    <section
      className={cn(
        "rounded-2xl border border-white/[0.06] bg-foreground/[0.04] overflow-hidden",
        className,
      )}
      data-testid="mobile-section-accordion"
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left hover:bg-foreground/[0.02] transition-colors"
      >
        <span className="font-mono text-xs font-bold text-qep-orange tracking-wider tabular-nums">
          {formatted}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-foreground truncate">
            {title}
          </span>
          {caption && (
            <span className="block text-xs text-muted-foreground mt-0.5 truncate">
              {caption}
            </span>
          )}
        </span>
        {trailing && <span className="shrink-0">{trailing}</span>}
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform shrink-0",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div id={bodyId} className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
          {children}
        </div>
      )}
    </section>
  );
}
