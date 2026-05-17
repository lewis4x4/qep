import { useEffect, useRef, type KeyboardEvent } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileWizardStepStatus = "done" | "current" | "locked" | "available";

export interface MobileWizardStep {
  id: string;
  label: string;
  status: MobileWizardStepStatus;
}

export interface MobileWizardStepperProps {
  steps: MobileWizardStep[];
  onStepClick?: (stepId: string) => void;
  /** Optional aria-label for the stepper nav. */
  ariaLabel?: string;
  /** Optional className passthrough on the outer nav. */
  className?: string;
}

/**
 * Horizontal scrolling chip rail that replaces dense wizard tile grids
 * (Quote Builder's 11-step grid, Field Note's 5-step, Voice Quote's 4-step)
 * on mobile. Pins the current step to the left edge with snap-scroll.
 *
 * Keyboard nav: ArrowLeft / ArrowRight cycle through non-locked steps.
 */
export function MobileWizardStepper({
  steps,
  onStepClick,
  ariaLabel = "Wizard progress",
  className,
}: MobileWizardStepperProps) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Scroll current step into view (left-pinned) whenever it changes.
  useEffect(() => {
    const currentIndex = steps.findIndex((s) => s.status === "current");
    if (currentIndex < 0) return;
    const target = buttonRefs.current[currentIndex];
    const container = scrollRef.current;
    if (!target || !container) return;
    container.scrollTo({
      left: target.offsetLeft - 12,
      behavior: "smooth",
    });
  }, [steps]);

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    let next = index + direction;
    while (next >= 0 && next < steps.length && steps[next]?.status === "locked") {
      next += direction;
    }
    if (next < 0 || next >= steps.length) return;
    buttonRefs.current[next]?.focus();
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("w-full", className)}
      data-testid="mobile-wizard-stepper"
    >
      <ol
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scroll-smooth snap-x snap-mandatory px-3 pb-2 pt-1 -mx-3 scrollbar-none"
        role="list"
      >
        {steps.map((step, index) => {
          const locked = step.status === "locked";
          const done = step.status === "done";
          const current = step.status === "current";
          return (
            <li key={step.id} className="snap-start shrink-0" role="listitem">
              <button
                ref={(node) => {
                  buttonRefs.current[index] = node;
                }}
                type="button"
                aria-current={current ? "step" : undefined}
                aria-disabled={locked || undefined}
                disabled={locked}
                onClick={() => !locked && onStepClick?.(step.id)}
                onKeyDown={(event) => handleKey(event, index)}
                className={cn(
                  "flex items-center gap-2 min-h-[44px] px-3.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-all",
                  current && "border-qep-orange bg-qep-orange text-white shadow-sm shadow-qep-orange/30",
                  done &&
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15",
                  step.status === "available" &&
                    "border-white/[0.12] bg-foreground/[0.04] text-foreground hover:border-white/30",
                  locked && "border-white/[0.06] bg-foreground/[0.02] text-muted-foreground/60 cursor-not-allowed",
                )}
                data-step-id={step.id}
                data-status={step.status}
              >
                <StepBadge index={index + 1} status={step.status} />
                <span className="truncate max-w-[140px]">{step.label}</span>
                {current && <span className="sr-only">(current step)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepBadge({
  index,
  status,
}: {
  index: number;
  status: MobileWizardStepStatus;
}) {
  if (status === "done") {
    return <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />;
  }
  if (status === "locked") {
    return <Lock className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />;
  }
  return (
    <span
      className={cn(
        "inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-bold",
        status === "current" ? "bg-white/20" : "bg-white/[0.08]",
      )}
      aria-hidden
    >
      {index}
    </span>
  );
}
