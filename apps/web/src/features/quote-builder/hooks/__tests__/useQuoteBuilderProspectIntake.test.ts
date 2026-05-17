import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useQuoteBuilderProspectIntake } from "../useQuoteBuilderProspectIntake";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

const baseDraft: QuoteWorkspaceDraft = {
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
};

describe("useQuoteBuilderProspectIntake", () => {
  it("fills walk-in prospect fields and jumps to equipment", () => {
    const setDraft = vi.fn((updater: (cur: QuoteWorkspaceDraft) => QuoteWorkspaceDraft) => {
      const next = updater(baseDraft);
      expect(next.customerName).toBe("Walk-in prospect");
      expect(next.customerCompany).toBe("Walk-in prospect");
      expect(next.contactId).toBeUndefined();
      expect(next.companyId).toBeUndefined();
      expect(next.customerSignals).toBeNull();
      return next;
    });
    const setStep = vi.fn();

    const { result } = renderHook(() =>
      useQuoteBuilderProspectIntake({ setDraft, setStep }),
    );

    act(() => {
      result.current();
    });

    expect(setStep).toHaveBeenCalledWith("equipment");
  });
});
