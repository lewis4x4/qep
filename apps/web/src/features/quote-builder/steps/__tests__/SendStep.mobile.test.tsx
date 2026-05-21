/**
 * WAVE parity-close (Slice 3) — SendStep deep reflow.
 *
 * On phone the readiness diagnostics collapse into an accordion, the
 * Back / Save follow-up footer pins to the bottom with safe-area
 * inset, and a successful send fills the upper viewport with a
 * full-bleed confirmation banner. Desktop keeps the inline Card +
 * footer layout.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  QuoteReadinessState,
  QuoteWorkspaceDraft,
} from "../../../../../../../shared/qep-moonshot-contracts";

import { SendStep } from "../SendStep";
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
    wizardStep: 11,
    customerName: "Pat Operator",
    customerCompany: "Sykes Earthworks",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "approved",
    followUpAt: "2026-06-01T10:00:00Z",
    whyThisMachineConfirmed: true,
  } as QuoteWorkspaceDraft;
}

function buildWizardValue(): WizardStateValue {
  return {
    step: "send",
    setStep: () => {},
    previousWizardStep: "document",
    nextWizardStep: null,
    currentWizardStepNumber: 11,
    maxCompletedStepIndex: 10,
    reachableMaxStepIndex: 10,
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

const READY: QuoteReadinessState = { ready: true, missing: [] };

const STEP_PROPS = {
  customerFacingDocumentBlocker: null,
  approvalCaseCanSend: true,
  approvalBlocker: null,
  documentReady: true,
  documentPersistenceLabel: "Stored 2026-05-17",
  taxResolved: true,
  taxResolutionBlocker: null,
  whyThisMachineRequired: false,
  whyThisMachineBlocker: null,
  previewReadiness: READY,
  emailReadiness: READY,
  textReadiness: READY,
  textQuoteEnabled: true,
  deliveryActionBusy: null,
  pdfGenerating: false,
  deliveryActionMessage: null,
  deliveryActionError: null,
  savePending: false,
  onPreview: () => {},
  onEmail: () => {},
  onText: () => {},
  onSaveFollowUp: () => {},
} as const;

describe("SendStep — mobile surface", () => {
  test("readiness gates collapse into an accordion at <640px", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <SendStep {...STEP_PROPS} />
      </Harness>,
    );
    expect(screen.getByText(/readiness gates/i)).toBeTruthy();
    expect(screen.getByText(/all gates clear/i)).toBeTruthy();
  });

  test("sticky footer pins Back + Save follow-up with sticky bottom-0", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <SendStep {...STEP_PROPS} />
      </Harness>,
    );
    const footer = screen.getByTestId("send-step-mobile-footer");
    expect(footer.className).toContain("sticky");
    expect(footer.className).toContain("bottom-0");

    const save = screen.getByTestId("send-step-save-followup") as HTMLButtonElement;
    expect(save.className).toContain("min-h-[44px]");
    const back = screen.getByTestId("send-step-back") as HTMLButtonElement;
    expect(back.className).toContain("min-h-[44px]");
  });

  test("shows honest prepared-SMS copy without claiming transport is live", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <SendStep {...STEP_PROPS} />
      </Harness>,
    );
    expect(screen.getByText(/SMS delivery is not connected yet/i)).toBeTruthy();
    expect(screen.getByText(/prepared template/i)).toBeTruthy();
    expect(screen.getByText(/\{\{proposal_link\}\}/i)).toBeTruthy();
  });

  test("renders the full-bleed success state when a delivery action lands", () => {
    stubMatchMedia(true);
    render(
      <Harness>
        <SendStep {...STEP_PROPS} deliveryActionMessage="Quote emailed at 10:42 AM" />
      </Harness>,
    );
    const banner = screen.getByTestId("send-step-mobile-success");
    expect(banner).toBeTruthy();
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toMatch(/emailed/i);
  });
});

describe("SendStep — desktop surface", () => {
  test("renders the inline readiness Card and standard footer at >= 640px", () => {
    stubMatchMedia(false);
    render(
      <Harness>
        <SendStep {...STEP_PROPS} />
      </Harness>,
    );
    expect(screen.queryByTestId("send-step-mobile-footer")).toBeNull();
    expect(screen.queryByTestId("send-step-mobile-success")).toBeNull();
    expect(screen.getByTestId("send-step-readiness-rows")).toBeTruthy();
  });

  test("no mobile-only success banner renders on desktop even after a send", () => {
    stubMatchMedia(false);
    render(
      <Harness>
        <SendStep {...STEP_PROPS} deliveryActionMessage="Quote emailed at 10:42 AM" />
      </Harness>,
    );
    expect(screen.queryByTestId("send-step-mobile-success")).toBeNull();
    // Desktop still shows the inline strip.
    expect(screen.getByText(/quote emailed/i)).toBeTruthy();
  });
});
