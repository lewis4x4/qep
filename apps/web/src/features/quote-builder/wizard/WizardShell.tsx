/**
 * PR 21 — Guided wizard chrome: step header card, branch selector, progress rail,
 * and mobile back/next controls (desktop nav hides on small screens).
 */

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { money } from "../lib/money";
import { QuoteWizardProgress } from "./WizardProgress";
import { STEP_LABELS, WIZARD_STEPS, type Step } from "./wizard-types";
import { useWizard } from "./useWizard";

export type QuotingBranchOption = {
  id: string;
  slug: string;
  display_name: string;
};

export interface WizardShellProps {
  currentWizardStepNumber: number;
  signalsReady: boolean;
  marginPct: number;
  marginAmount: number;
  wizardPricingJumpAllowed: boolean;
  branches: QuotingBranchOption[];
  wizardNextHelp: string;
  previousWizardStep: Step | null;
  nextWizardStep: Step | null;
  wizardNextDisabled: boolean;
  nextWizardLabel: string | null;
  hasCustomer: boolean;
  onQuoteForProspect: () => void;
  wizardMaxStepIndex0: number;
  children: ReactNode;
}

export function WizardShell({
  currentWizardStepNumber,
  signalsReady,
  marginPct,
  marginAmount,
  wizardPricingJumpAllowed,
  branches,
  wizardNextHelp,
  previousWizardStep,
  nextWizardStep,
  wizardNextDisabled,
  nextWizardLabel,
  hasCustomer,
  onQuoteForProspect,
  wizardMaxStepIndex0,
  children,
}: WizardShellProps) {
  const { step, setStep, draft, setDraft } = useWizard();

  return (
    <>
      <Card className="border-border/70 bg-card/80 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-qep-orange/10 px-3 py-1 text-xs font-semibold text-qep-orange">
                Step {currentWizardStepNumber} of {WIZARD_STEPS.length}
              </span>
              <span className="text-sm font-semibold text-foreground">{STEP_LABELS[step]}</span>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground" role="status" aria-live="polite">
              {signalsReady ? (
                <>
                  <span className="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Live margin </span>
                  <span className="font-semibold text-foreground">{marginPct.toFixed(1)}%</span>
                  <span> · </span>
                  <span className="font-semibold text-foreground">{money(marginAmount)}</span>
                  <span> est. net</span>
                </>
              ) : (
                "Live margin updates once this quote has a customer and at least one machine."
              )}
            </p>
            {wizardPricingJumpAllowed ? (
              <Button
                type="button"
                variant="link"
                title="Open step 5 — Pricing build"
                className="h-auto justify-start p-0 text-xs font-semibold text-qep-orange"
                onClick={() => setStep("pricing")}
              >
                Pricing →
              </Button>
            ) : null}
            {branches.length > 0 && (
              <label className="block max-w-xl space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Quoting branch</span>
                <select
                  value={draft.branchSlug}
                  onChange={(event) => setDraft((current) => ({ ...current, branchSlug: event.target.value }))}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-qep-orange focus:outline-none focus:ring-2 focus:ring-qep-orange/30"
                >
                  <option value="">Select quoting branch…</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.slug}>{branch.display_name}</option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-muted-foreground">{wizardNextHelp}</p>
          </div>
          <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
            {previousWizardStep && (
              <Button variant="outline" className="hidden touch-manipulation md:inline-flex" onClick={() => setStep(previousWizardStep)}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            )}
            {step === "customer" && !hasCustomer && (
              <Button variant="ghost" className="touch-manipulation" onClick={onQuoteForProspect}>
                Quote for prospect
              </Button>
            )}
            {nextWizardStep && (
              <Button
                className="hidden touch-manipulation md:inline-flex"
                onClick={() => setStep(nextWizardStep)}
                disabled={wizardNextDisabled}
              >
                {nextWizardLabel} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>

      <QuoteWizardProgress
        steps={WIZARD_STEPS}
        currentStep={step}
        maxCompletedStepIndex={wizardMaxStepIndex0}
        compact
        onJumpTo={setStep}
      />

      <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom,0px))] z-20 flex touch-manipulation flex-col gap-2 rounded-xl border border-border/70 bg-card/95 p-3 shadow-md backdrop-blur md:hidden">
        {signalsReady ? (
          <p className="text-center text-[10px] leading-tight text-muted-foreground" role="status" aria-live="polite">
            <span className="font-semibold text-foreground">{marginPct.toFixed(1)}%</span>
            {" · "}
            <span className="font-semibold text-foreground">{money(marginAmount)}</span>
            <span> net</span>
          </p>
        ) : null}
        {wizardPricingJumpAllowed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full touch-manipulation text-[10px] font-semibold"
            title="Open step 5 — Pricing build"
            onClick={() => setStep("pricing")}
          >
            Pricing
          </Button>
        ) : null}
        <div className={`flex gap-2 ${previousWizardStep && nextWizardStep ? "" : "flex-col sm:flex-row"}`}>
          {previousWizardStep ? (
            <Button
              type="button"
              variant="outline"
              className={nextWizardStep ? "min-w-0 flex-1 touch-manipulation" : "w-full touch-manipulation"}
              onClick={() => setStep(previousWizardStep)}
            >
              <ArrowLeft className="mr-1 h-4 w-4 shrink-0" /> Back
            </Button>
          ) : (
            nextWizardStep ? <span className="flex-1" aria-hidden="true" /> : null
          )}
          {nextWizardStep ? (
            <Button
              type="button"
              className={previousWizardStep ? "min-w-0 flex-1 touch-manipulation" : "w-full touch-manipulation"}
              onClick={() => setStep(nextWizardStep)}
              disabled={wizardNextDisabled}
            >
              <span className="truncate">{nextWizardLabel}</span>
              <ArrowRight className="ml-1 h-4 w-4 shrink-0" />
            </Button>
          ) : null}
        </div>
        {step === "customer" && !hasCustomer ? (
          <Button type="button" variant="outline" className="w-full touch-manipulation" onClick={onQuoteForProspect}>
            Quote for prospect
          </Button>
        ) : null}
      </div>

      {children}
    </>
  );
}
