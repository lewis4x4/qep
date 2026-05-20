import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { QuoteBuilderV2PageShell, type QuoteBuilderV2PageShellProps } from "../QuoteBuilderV2PageShell";
import { WizardStateProvider, type WizardStateValue } from "../../wizard/WizardStateProvider";

mock.module("@/components/primitives", () => ({
  AskIronAdvisorButton: () => null,
}));

mock.module("../ConversationalDealEngine", () => ({
  DealAssistantTrigger: () => null,
}));

mock.module("../QuoteBuilderStickyBar", () => ({
  QuoteBuilderStickyBar: () => null,
}));

mock.module("../QuoteBuilderStatusBanners", () => ({
  QuoteBuilderStatusBanners: () => null,
}));

mock.module("../QuoteBuilderOverlays", () => ({
  QuoteBuilderOverlays: () => null,
}));

mock.module("../MarginFloorGate", () => ({
  MarginFloorGate: () => null,
}));

mock.module("../wizard/WizardShell", () => ({
  WizardShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const dealCoachSidebarMock = mock((props: unknown) => <div data-props={JSON.stringify(props)} />);

mock.module("../DealCoachSidebar", () => ({
  DealCoachSidebar: dealCoachSidebarMock,
}));

mock.module("../MobileIntelligencePanelHost", () => ({
  MobileIntelligencePanelHost: ({ dealCoachPanel }: { dealCoachPanel: ReactNode }) => <>{dealCoachPanel}</>,
}));

function buildProps(): QuoteBuilderV2PageShellProps {
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
      equipment: [{ id: "eq-1" }],
      attachments: [],
      voiceSummary: null,
      entryMode: "manual",
      dealId: null,
      companyId: null,
      customerCompany: "",
      customerName: "",
    } as never,
    step: "pricing",
    dealAssistantOpen: false,
    onDealAssistantOpenChange: () => undefined,
    activeQuotePackageId: "pkg-1",
    activeQuoteNumber: null,
    activeQuoteUpdatedAt: null,
    existingQuoteLoadError: null,
    existingQuoteEditingMessage: null,
    currentWizardStepNumber: 5,
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
    wizardStepRouter: <div />,
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
    tradeMarketContext: {
      valuationBand: { low: 100000, high: 120000, midpoint: 110000 },
      marketCompRange: { low: 98000, high: 122000 },
      confidence: "medium",
      creditBasis: { basis: "retail", amount: 110000 },
      sources: [],
    } as never,
    tradeMarketContextLoading: true,
    tradeWalkaroundHref: "/qrm/deals/deal-123/trade-walkaround",
    overlays: {} as never,
  };
}

function buildWizardValue(): WizardStateValue {
  const fn = (() => undefined) as unknown as WizardStateValue["setStep"];
  const autoSaveSetter = (() => undefined) as unknown as WizardStateValue["setAutoSaveState"];
  const lastSavedSetter = (() => undefined) as unknown as WizardStateValue["setLastSavedAt"];
  const setDraft = (() => undefined) as unknown as WizardStateValue["setDraft"];

  return {
    step: "pricing",
    setStep: fn,
    previousWizardStep: "tradeIn",
    nextWizardStep: null,
    currentWizardStepNumber: 5,
    maxCompletedStepIndex: 0,
    reachableMaxStepIndex: 0,
    draft: { equipment: [], attachments: [] } as never,
    setDraft,
    activeWorkspaceId: "ws-1",
    activeQuotePackageId: "pkg-1",
    autoSaveState: "idle",
    setAutoSaveState: autoSaveSetter,
    lastSavedAt: null,
    setLastSavedAt: lastSavedSetter,
  };
}

describe("QuoteBuilderV2PageShell trade prop wiring", () => {
  test("threads trade market props into Deal Coach sidebar for desktop and mobile shell paths", () => {
    render(
      <MemoryRouter>
        <WizardStateProvider value={buildWizardValue()}>
          <QuoteBuilderV2PageShell {...buildProps()} />
        </WizardStateProvider>
      </MemoryRouter>,
    );

    expect(dealCoachSidebarMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    for (const [call] of dealCoachSidebarMock.mock.calls) {
      const props = call as Record<string, unknown>;
      expect(props.tradeMarketContextLoading).toBe(true);
      expect(props.tradeWalkaroundHref).toBe("/qrm/deals/deal-123/trade-walkaround");
      expect(props.tradeMarketContext).toBeTruthy();
    }
  });
});
