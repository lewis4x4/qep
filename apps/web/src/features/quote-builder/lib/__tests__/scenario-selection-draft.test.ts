import { describe, expect, test } from "bun:test";

import { buildScenarioSelectionDraftPatch } from "../scenario-selection-draft";
import type { ScenarioSelection } from "../../components/ConversationalDealEngine";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

const scenario = {
  label: "Low cash option",
  description: "Keeps cash outlay down.",
  programIds: ["program-1"],
  customerOutOfPocketCents: 2500000,
  monthlyPaymentCents: 125000,
  termMonths: 48,
  totalPaidByCustomerCents: 6000000,
  dealerMarginCents: 800000,
  dealerMarginPct: 12.5,
  commissionCents: 120000,
  pros: ["Fast delivery"],
  cons: ["Needs approval"],
};

function draftFixture(partial: Partial<QuoteWorkspaceDraft> = {}): QuoteWorkspaceDraft {
  return {
    entryMode: "manual",
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
    quoteStatus: "draft",
    ...partial,
  };
}

function selectionFixture(partial: Partial<ScenarioSelection> = {}): ScenarioSelection {
  return {
    scenario,
    resolvedModelId: "model-12345678",
    resolvedBrandId: null,
    deliveryState: "NC",
    customerType: "standard",
    prompt: "Customer needs a compact track loader.",
    originatingLogId: "log-1",
    ...partial,
  };
}

describe("scenario selection draft patch", () => {
  test("keeps in-builder deal assistant selections generic", () => {
    const current = draftFixture();
    const patch = buildScenarioSelectionDraftPatch(current, selectionFixture(), "deal_assistant");
    const next = { ...current, ...patch };

    expect(next.entryMode).toBe("manual");
    expect(next.recommendation).toBeNull();
    expect(next.voiceSummary).toBe("Customer needs a compact track loader.");
    expect(next.originatingLogId).toBe("log-1");
    expect(next.equipment[0]?.id).toBe("model-12345678");
  });

  test("marks URL voice handoffs as voice-originated", () => {
    const current = draftFixture();
    const patch = buildScenarioSelectionDraftPatch(
      current,
      { ...selectionFixture(), at: "2026-05-06T20:00:00Z" },
      "voice_handoff",
    );
    const next = { ...current, ...patch };

    expect(next.entryMode).toBe("voice");
    expect(next.recommendation?.trigger?.triggerType).toBe("voice_transcript");
    expect(next.recommendation?.trigger?.sourceField).toBe("voice_quote_handoff");
    expect(next.recommendation?.trigger?.createdAt).toBe("2026-05-06T20:00:00Z");
  });
});
