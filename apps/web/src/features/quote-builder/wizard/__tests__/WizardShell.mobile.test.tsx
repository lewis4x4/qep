/**
 * WAVE quote-builder polish (Slice 1) — WizardShell now mounts the
 * MobileWizardStepper chip rail at mobile viewports and falls back to
 * the existing QuoteWizardProgress on desktop. This spec drives the
 * branch with a stub matchMedia and the minimum WizardStateProvider
 * value required to render the shell.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import { WizardShell } from "../WizardShell";
import {
  WizardStateProvider,
  type WizardStateValue,
} from "../WizardStateProvider";

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(matches: boolean): void {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
    query: string,
  ) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    originalMatchMedia;
  cleanup();
});

beforeEach(() => {
  stubMatchMedia(false);
});

function buildDraft(): QuoteWorkspaceDraft {
  return {
    entryMode: "ai_chat",
    branchSlug: "",
    recommendation: null,
    voiceSummary: null,
    equipment: [],
    attachments: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 0,
    selectedFinanceScenario: null,
    pricingLines: [],
    postApprovalAction: "return_to_rep",
    wizardStep: 1,
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "draft",
  } as QuoteWorkspaceDraft;
}

function buildWizardValue(): WizardStateValue {
  return {
    step: "pricing",
    setStep: () => {},
    previousWizardStep: "tradeIn",
    nextWizardStep: "promotions",
    currentWizardStepNumber: 5,
    maxCompletedStepIndex: 4,
    reachableMaxStepIndex: 4,
    draft: buildDraft(),
    setDraft: () => {},
    activeWorkspaceId: null,
    activeQuotePackageId: null,
    autoSaveState: "idle",
    setAutoSaveState: () => {},
    lastSavedAt: null,
    setLastSavedAt: () => {},
  };
}

function Harness({ children }: { children: ReactNode }) {
  return (
    <WizardStateProvider value={buildWizardValue()}>{children}</WizardStateProvider>
  );
}

const SHELL_PROPS = {
  currentWizardStepNumber: 5,
  signalsReady: true,
  marginPct: 22.5,
  marginAmount: 18_000,
  wizardPricingJumpAllowed: false,
  branches: [],
  wizardNextHelp: "Continue when ready.",
  previousWizardStep: "tradeIn" as const,
  nextWizardStep: "promotions" as const,
  wizardNextDisabled: false,
  nextWizardLabel: "Promos",
  hasCustomer: true,
  onQuoteForProspect: () => {},
  wizardMaxStepIndex0: 4,
  children: <div data-testid="wizard-shell-children">child content</div>,
};

describe("WizardShell mobile stepper swap", () => {
  test("renders MobileWizardStepper at phone viewport", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <WizardShell {...SHELL_PROPS} />
      </Harness>,
    );
    expect(screen.getByTestId("mobile-wizard-stepper")).toBeTruthy();
    expect(screen.queryByText(/Wizard progress/i)).toBeNull();
  });

  test("renders QuoteWizardProgress at desktop viewport", () => {
    stubMatchMedia(false);
    render(
      <Harness>
        <WizardShell {...SHELL_PROPS} />
      </Harness>,
    );
    expect(screen.queryByTestId("mobile-wizard-stepper")).toBeNull();
    expect(screen.getByText(/Wizard progress/i)).toBeTruthy();
  });

  test("MobileWizardStepper marks the current step appropriately on mobile", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <WizardShell {...SHELL_PROPS} />
      </Harness>,
    );
    // currentWizardStepNumber is 5 ('pricing') → its chip carries aria-current="step"
    const current = screen.getByRole("button", { name: /pricing/i });
    expect(current.getAttribute("aria-current")).toBe("step");
  });
});
