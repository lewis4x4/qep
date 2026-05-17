/**
 * WAVE parity-close (Slice 2) — DocumentStep deep reflow.
 *
 * On phone the dense preview-summary collapses behind a "View summary"
 * MobileBottomSheet trigger, the action buttons land in a sticky row
 * pinned with `env(safe-area-inset-bottom)`, and the storage-artifact
 * informational card collapses into a MobileSectionAccordion. Desktop
 * keeps the inline Card layout.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import { DocumentStep } from "../DocumentStep";
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
    wizardStep: 10,
    customerName: "Pat Operator",
    customerCompany: "Sykes Earthworks",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "draft",
  } as QuoteWorkspaceDraft;
}

function buildWizardValue(): WizardStateValue {
  return {
    step: "document",
    setStep: () => {},
    previousWizardStep: "review",
    nextWizardStep: "send",
    currentWizardStepNumber: 10,
    maxCompletedStepIndex: 9,
    reachableMaxStepIndex: 9,
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
    <WizardStateProvider value={buildWizardValue()}>
      {children}
    </WizardStateProvider>
  );
}

const STEP_PROPS = {
  quoteTitle: "Sykes Earthworks — JD 9R",
  customerTotal: 480_000,
  financeMethodLabel: "Cash",
  documentPersistenceLabel: "Awaiting generation",
  documentFallbackGeneratedAt: null,
  documentArtifact: null,
  customerFacingDocumentBlocker: null,
  pdfGenerating: false,
  quoteMediaSnapshotLoading: false,
  documentActionError: null,
  documentReady: true,
  onGenerateDocument: () => {},
};

describe("DocumentStep — mobile surface", () => {
  test("renders the sticky action row at the bottom of the mobile surface", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <DocumentStep {...STEP_PROPS} />
      </Harness>,
    );
    const actions = screen.getByTestId("document-step-mobile-actions");
    expect(actions).toBeTruthy();
    // Sticky + bottom-0 keeps the action row visible inside iOS Safari
    // URL chrome; the inline `env(safe-area-inset-bottom)` padding is
    // applied via React's style prop (happy-dom drops the env() value
    // during normalization so we don't assert on it here — the e2e
    // viewport pass covers the real-browser behavior).
    expect(actions.className).toContain("sticky");
    expect(actions.className).toContain("bottom-0");
  });

  test("Generate + Print buttons land 44pt min-height", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <DocumentStep {...STEP_PROPS} />
      </Harness>,
    );
    const generate = screen.getByTestId("document-step-generate") as HTMLButtonElement;
    const print = screen.getByTestId("document-step-print") as HTMLButtonElement;
    expect(generate.className).toContain("min-h-[44px]");
    expect(print.className).toContain("min-h-[44px]");
  });

  test("opens the preview-summary inside MobileBottomSheet on tap", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <DocumentStep {...STEP_PROPS} />
      </Harness>,
    );
    fireEvent.click(screen.getByTestId("document-step-open-preview"));
    const summary = screen.getByTestId("document-step-preview-summary");
    expect(summary).toBeTruthy();
    const panel = screen.getByTestId("mobile-bottom-sheet-panel");
    expect(panel.getAttribute("data-mobile-sheet")).toBe("true");
  });
});

describe("DocumentStep — desktop surface", () => {
  test("renders the inline preview Card and does NOT mount the mobile surface at >= 640px", () => {
    stubMatchMedia(false);
    render(
      <Harness>
        <DocumentStep {...STEP_PROPS} />
      </Harness>,
    );
    expect(screen.queryByTestId("document-step-mobile-surface")).toBeNull();
    expect(screen.queryByTestId("document-step-mobile-actions")).toBeNull();
    // The desktop Card still surfaces the preview summary inline.
    expect(screen.getByText(/quote document preview/i)).toBeTruthy();
  });
});
