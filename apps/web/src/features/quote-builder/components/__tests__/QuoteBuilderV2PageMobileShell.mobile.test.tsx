import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { WizardStateProvider, type WizardStateValue } from "../../wizard/WizardStateProvider";
import { QuoteBuilderV2PageMobileShell } from "../QuoteBuilderV2PageMobileShell";
import type { QuoteBuilderV2PageShellProps } from "../QuoteBuilderV2PageShell";

mock.module("../ConversationalDealEngine", () => ({
  DealAssistantTrigger: () => <div data-testid="deal-assistant-trigger" />,
}));

mock.module("../DealCoachSidebar", () => ({
  DealCoachSidebar: () => <div data-testid="deal-coach-sidebar" />,
}));

mock.module("../MarginFloorGate", () => ({
  MarginFloorGate: () => null,
}));

mock.module("../QuoteBuilderOverlays", () => ({
  QuoteBuilderOverlays: () => null,
}));

mock.module("../QuoteBuilderStatusBanners", () => ({
  QuoteBuilderStatusBanners: () => null,
}));

mock.module("@/features/sales/components/MobileBottomSheet", () => ({
  MobileBottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function buildWizardValue(step: WizardStateValue["step"]): WizardStateValue {
  const fn = (() => undefined) as unknown as WizardStateValue["setStep"];
  const autoSaveSetter = (() => undefined) as unknown as WizardStateValue["setAutoSaveState"];
  const lastSavedSetter = (() => undefined) as unknown as WizardStateValue["setLastSavedAt"];
  const setDraft = (() => undefined) as unknown as WizardStateValue["setDraft"];

  return {
    step,
    setStep: fn,
    previousWizardStep: step === "pricing" ? "tradeIn" : null,
    nextWizardStep: null,
    currentWizardStepNumber: step === "pricing" ? 5 : 1,
    maxCompletedStepIndex: 0,
    reachableMaxStepIndex: 0,
    draft: { equipment: [], attachments: [] } as never,
    setDraft,
    activeWorkspaceId: "ws-1",
    activeQuotePackageId: null,
    autoSaveState: "idle",
    setAutoSaveState: autoSaveSetter,
    lastSavedAt: null,
    setLastSavedAt: lastSavedSetter,
  };
}

function buildProps(step: WizardStateValue["step"]): QuoteBuilderV2PageShellProps {
  return {
    quoteTitle: "Quote",
    quoteStatus: "draft",
    autoSaveState: "idle",
    displayedSavedLabel: null,
    packetReadiness: { blockers: [], checks: [] } as never,
    customerTotal: 0,
    financeMethodLabel: "Cash",
    primaryActionLabel: "Continue",
    primaryActionDisabled: false,
    primaryActionPending: false,
    primaryActionShowsSendIcon: false,
    onPrimaryAction: () => undefined,
    draft: {
      equipment: [],
      attachments: [],
      voiceSummary: null,
      entryMode: "manual",
      dealId: null,
      companyId: null,
      customerCompany: "",
      customerName: "",
    } as never,
    step,
    dealAssistantOpen: false,
    onDealAssistantOpenChange: () => undefined,
    activeQuotePackageId: null,
    activeQuoteNumber: null,
    activeQuoteUpdatedAt: null,
    existingQuoteLoadError: null,
    existingQuoteEditingMessage: null,
    currentWizardStepNumber: step === "pricing" ? 5 : 1,
    signalsReady: true,
    marginPct: 12,
    marginAmount: 1000,
    wizardPricingJumpAllowed: true,
    branches: [],
    wizardNextHelp: "",
    previousWizardStep: null,
    nextWizardStep: null,
    wizardNextDisabled: false,
    nextWizardLabel: null,
    hasCustomer: true,
    onQuoteForProspect: () => undefined,
    wizardMaxStepIndex0: 0,
    wizardStepRouter: <div data-testid="wizard-content">{step}-content</div>,
    equipmentTotal: 0,
    attachmentTotal: 0,
    subtotal: 0,
    netTotal: 0,
    marginGateOpen: false,
    onMarginGateOpenChange: () => undefined,
    onMarginReasonConfirm: () => undefined,
    pdfError: null,
    saveSuccess: false,
    saveErrorMessage: null,
    submitApprovalErrorMessage: null,
    onRecoveryAction: undefined,
    intelligencePanel: null,
    overlays: {} as never,
  };
}

function renderShell(step: WizardStateValue["step"]) {
  const props = buildProps(step);
  const wizardValue = buildWizardValue(step);

  return render(
    <MemoryRouter>
      <WizardStateProvider value={wizardValue}>
        <QuoteBuilderV2PageMobileShell {...props} />
      </WizardStateProvider>
    </MemoryRouter>,
  );
}

describe("QuoteBuilderV2PageMobileShell mobile section framing", () => {
  test("renders neutral frame around active who/what section content", () => {
    renderShell("customer");

    const frame = screen.getByTestId("quote-mobile-active-section-frame");
    expect(frame.getAttribute("data-section-id")).toBe("who_what");
    expect(frame.className).toContain("border-white/[0.08]");
    expect(frame.className).toContain("bg-foreground/[0.03]");
    expect(screen.getByTestId("wizard-content").textContent).toContain("customer-content");
  });

  test("renders orange frame around active price section content", () => {
    renderShell("pricing");

    const frame = screen.getByTestId("quote-mobile-active-section-frame");
    expect(frame.getAttribute("data-section-id")).toBe("price");
    expect(frame.className).toContain("border-qep-orange/25");
    expect(frame.className).toContain("bg-qep-orange/[0.06]");
    expect(screen.getByTestId("wizard-content").textContent).toContain("pricing-content");
  });
});
