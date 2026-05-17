/**
 * WAVE parity-close (Slice 1) — CustomerStep deep reflow.
 *
 * On phone the picker hides behind a MobileBottomSheet trigger so the
 * inline dropdown can't fall behind the iOS keyboard. On desktop the
 * existing CustomerSection renders inline. This spec drives both
 * branches behind a stubbed matchMedia.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import { CustomerStep } from "../CustomerStep";
import {
  WizardStateProvider,
  type WizardStateValue,
} from "../../wizard/WizardStateProvider";

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
    step: "customer",
    setStep: () => {},
    previousWizardStep: null,
    nextWizardStep: "equipment",
    currentWizardStepNumber: 1,
    maxCompletedStepIndex: 0,
    reachableMaxStepIndex: 0,
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
  // Fresh QueryClient per render so each test starts with an empty
  // cache — CustomerSection's child queries (signals, deal counts)
  // would otherwise share state across tests.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <WizardStateProvider value={buildWizardValue()}>
        {children}
      </WizardStateProvider>
    </QueryClientProvider>
  );
}

const STEP_PROPS = {
  aiPrompt: "",
  setAiPrompt: () => {},
  intakeRecorderOpen: false,
  setIntakeRecorderOpen: () => {},
  onVoiceRecorded: () => {},
  voiceMutationPending: false,
  onBuildWithAi: () => {},
  aiIntakeMutationPending: false,
  aiIntakeMessage: null,
  winProbContext: {} as never,
  factorVerdicts: null,
  shadowHistory: null,
  shadowCalibration: null,
  intelligencePanel: null,
} as const;

describe("CustomerStep — mobile picker surface", () => {
  test("renders the Find a customer trigger at <640px instead of an inline dropdown", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <CustomerStep {...STEP_PROPS} />
      </Harness>,
    );
    expect(screen.getByTestId("customer-step-mobile-surface")).toBeTruthy();
    const finder = screen.getByTestId("customer-step-open-picker") as HTMLButtonElement;
    expect(finder.textContent).toMatch(/find a customer/i);
    expect(finder.className).toContain("min-h-[44px]");
  });

  test("exposes the manual-entry CTA on the same mobile surface", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <CustomerStep {...STEP_PROPS} />
      </Harness>,
    );
    const manual = screen.getByTestId("customer-step-open-manual") as HTMLButtonElement;
    expect(manual.textContent).toMatch(/add new customer/i);
    expect(manual.className).toContain("min-h-[44px]");
  });

  test("opens the picker inside a MobileBottomSheet when the rep taps Find a customer", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <CustomerStep {...STEP_PROPS} />
      </Harness>,
    );
    fireEvent.click(screen.getByTestId("customer-step-open-picker"));
    expect(screen.getByTestId("customer-step-picker-sheet")).toBeTruthy();
    // The MobileBottomSheet panel stamps data-mobile-sheet="true" so the
    // e2e [role="dialog"]:not([data-mobile-sheet]) gate stays clean.
    const panel = screen.getByTestId("mobile-bottom-sheet-panel");
    expect(panel.getAttribute("data-mobile-sheet")).toBe("true");
  });
});

describe("CustomerStep — desktop picker surface", () => {
  test("renders the inline CustomerSection (no mobile surface) at >= 640px", () => {
    stubMatchMedia(false);
    render(
      <Harness>
        <CustomerStep {...STEP_PROPS} />
      </Harness>,
    );
    expect(screen.queryByTestId("customer-step-mobile-surface")).toBeNull();
    expect(screen.queryByTestId("customer-step-open-picker")).toBeNull();
    // The inline CustomerSection mounts CustomerPicker with its search
    // input; assert that the search input is present without depending
    // on the role helper (the Input is a plain textbox, not combobox).
    const searchInput = document.querySelector("input[type=\"search\"], input[placeholder*='Search'], input[placeholder*='search']");
    expect(searchInput).not.toBeNull();
  });
});
