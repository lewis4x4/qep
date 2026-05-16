// QRM Quote Wizard — progress / step-pill component.
//
// Extracted from `QuoteBuilderV2Page.tsx` as PR 2 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence.
// Pure presentation: every previously-completed step is clickable in
// both directions via `maxCompletedStepIndex`; future steps are locked.
// Compact mode strips the helper copy and tightens spacing for mobile.

import { Card } from "@/components/ui/card";

import { canJumpToWizardIndex } from "./wizard-navigation";
import type { Step, WizardStepMeta } from "./wizard-types";

export interface QuoteWizardProgressProps {
  steps: readonly WizardStepMeta[];
  currentStep: Step;
  maxCompletedStepIndex: number;
  compact?: boolean;
  onJumpTo: (step: Step) => void;
}

export function QuoteWizardProgress({
  steps,
  currentStep,
  maxCompletedStepIndex,
  compact = false,
  onJumpTo,
}: QuoteWizardProgressProps) {
  const currentIndex = steps.findIndex((item) => item.id === currentStep);
  const maxCompletedIndex = Math.min(Math.max(maxCompletedStepIndex, currentIndex), steps.length - 1);
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Wizard progress</p>
          <p className="mt-1 text-sm font-medium text-foreground">{steps[currentIndex]?.label ?? "Customer"}</p>
        </div>
        <span className="rounded-full bg-qep-orange/10 px-3 py-1 text-xs font-semibold text-qep-orange">
          Step {Math.max(1, currentIndex + 1)} of {steps.length}
        </span>
      </div>
      {!compact ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Finished steps remain editable. Use the green buttons to jump back without losing later draft work.
        </p>
      ) : null}
      <div className={`mt-3 grid grid-flow-col gap-2 overflow-x-auto pb-1 ${
        compact ? "[grid-auto-columns:minmax(4.75rem,1fr)] sm:[grid-auto-columns:minmax(7.5rem,1fr)]" : "[grid-auto-columns:minmax(7.5rem,1fr)]"
      }`}>
        {steps.map((item, index) => {
          const isCurrent = item.id === currentStep;
          const isReachable = canJumpToWizardIndex(index, maxCompletedIndex);
          const isComplete = index < currentIndex || (index !== currentIndex && isReachable);
          const isFuture = !isReachable;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { if (isReachable) onJumpTo(item.id); }}
              disabled={isFuture}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`${item.number}. ${item.label}: ${isCurrent ? "current step" : isComplete ? "editable step" : "locked step"}`}
              className={`${compact ? "min-h-[3.25rem] px-2 py-1.5 sm:min-h-[4.25rem] sm:px-3 sm:py-2" : "min-h-[4.25rem] px-3 py-2"} touch-manipulation rounded-lg border text-left text-[11px] leading-tight transition ${
                isCurrent
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange shadow-[0_0_0_1px_rgba(249,115,22,0.25)]"
                  : isComplete
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:border-emerald-400/60"
                    : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">{item.number}.</span>
              <span className={`${compact ? "mt-0.5 block text-[10px] leading-snug sm:text-[11px]" : "mt-1 block"} whitespace-normal break-words font-semibold`}>{item.shortLabel}</span>
              <span className={`${compact ? "mt-0.5 sm:mt-1" : "mt-1"} block text-[10px] opacity-80`}>
                {isCurrent ? "Now" : isComplete ? "Edit" : item.owner === "placeholder" ? "Later" : "Locked"}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
