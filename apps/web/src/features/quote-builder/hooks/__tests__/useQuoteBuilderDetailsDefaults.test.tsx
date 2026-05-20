import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useState } from "react";

import { useQuoteBuilderDetailsDefaults } from "../useQuoteBuilderDetailsDefaults";
import type { Step } from "../../wizard/wizard-types";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function makeDraft(overrides: Partial<QuoteWorkspaceDraft> = {}): QuoteWorkspaceDraft {
  return {
    entryMode: "manual",
    branchSlug: "lake-city",
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
    customerName: "",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "",
    customerSignals: null,
    customerWarmth: null,
    ...overrides,
  } as QuoteWorkspaceDraft;
}

function useHarness(step: Step, initialDraft: QuoteWorkspaceDraft): QuoteWorkspaceDraft {
  const [draft, setDraft] = useState(initialDraft);
  useQuoteBuilderDetailsDefaults({ step, setDraft });
  return draft;
}

describe("useQuoteBuilderDetailsDefaults", () => {
  test("preserves user-edited lifecycle dates", () => {
    const { result } = renderHook(() => useHarness("details", makeDraft({
      expiresAt: "2026-07-01T12:00:00.000Z",
      followUpAt: "2026-05-25T15:00:00.000Z",
      whyThisMachine: "Rep-written narrative.",
      whyThisMachineConfirmed: true,
    })));

    expect(result.current.expiresAt).toBe("2026-07-01T12:00:00.000Z");
    expect(result.current.followUpAt).toBe("2026-05-25T15:00:00.000Z");
    expect(result.current.whyThisMachine).toBe("Rep-written narrative.");
    expect(result.current.whyThisMachineConfirmed).toBe(true);
  });

  test("does not seed defaults outside details or send", () => {
    const { result } = renderHook(() => useHarness("pricing", makeDraft()));

    expect(result.current.expiresAt).toBeUndefined();
    expect(result.current.followUpAt).toBeUndefined();
    expect(result.current.whyThisMachine).toBeUndefined();
    expect(result.current.whyThisMachineConfirmed).toBeUndefined();
  });
});
