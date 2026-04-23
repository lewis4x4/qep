import { describe, expect, test } from "bun:test";
import { hydrateDraftFromSavedQuote } from "../saved-quote-draft";

describe("hydrateDraftFromSavedQuote", () => {
  test("maps a persisted quote package into an editable workspace draft", () => {
    const draft = hydrateDraftFromSavedQuote({
      id: "pkg-123",
      deal_id: "deal-123",
      contact_id: "contact-123",
      company_id: "company-123",
      entry_mode: "voice",
      branch_slug: "raleigh",
      equipment: [
        { id: "machine-1", make: "Kubota", model: "KX040", year: 2024, price: 57500 },
      ],
      attachments_included: [
        { name: "Hydraulic thumb", price: 4200 },
      ],
      trade_allowance: 8000,
      trade_in_valuation_id: "trade-123",
      commercial_discount_type: "percent",
      commercial_discount_value: 7.5,
      cash_down: 5000,
      tax_profile: "government_exempt",
      tax_total: 0,
      amount_financed: 48700,
      selected_finance_scenario: "48 mo @ 0%",
      customer_name: "Thomas Sykes",
      customer_company: "Sykes Earthworks",
      customer_phone: "919-555-0100",
      customer_email: "thomas@example.com",
      originating_log_id: "log-123",
      ai_recommendation: {
        machine: "Kubota KX040",
        attachments: ["Hydraulic thumb"],
        reasoning: "Matches trenching depth and trailer limits.",
      },
    });

    expect(draft).toMatchObject({
      dealId: "deal-123",
      contactId: "contact-123",
      companyId: "company-123",
      entryMode: "voice",
      branchSlug: "raleigh",
      tradeAllowance: 8000,
      tradeValuationId: "trade-123",
      commercialDiscountType: "percent",
      commercialDiscountValue: 7.5,
      cashDown: 5000,
      taxProfile: "government_exempt",
      taxTotal: 0,
      amountFinanced: 48700,
      selectedFinanceScenario: "48 mo @ 0%",
      customerName: "Thomas Sykes",
      customerCompany: "Sykes Earthworks",
      customerPhone: "919-555-0100",
      customerEmail: "thomas@example.com",
      originatingLogId: "log-123",
      recommendation: {
        machine: "Kubota KX040",
        attachments: ["Hydraulic thumb"],
        reasoning: "Matches trenching depth and trailer limits.",
      },
    });

    expect(draft.equipment).toEqual([
      {
        kind: "equipment",
        id: "machine-1",
        title: "Kubota KX040 (2024)",
        make: "Kubota",
        model: "KX040",
        year: 2024,
        quantity: 1,
        unitPrice: 57500,
      },
    ]);
    expect(draft.attachments).toEqual([
      {
        kind: "attachment",
        title: "Hydraulic thumb",
        quantity: 1,
        unitPrice: 4200,
      },
    ]);
  });

  test("falls back to safe defaults for sparse or legacy quote rows", () => {
    const draft = hydrateDraftFromSavedQuote({
      deal_id: "deal-456",
      equipment: [{ make: "ASV", model: "RT-135", amount: 102000 }],
      financing_scenarios: [{ label: "Cash" }],
      trade_credit: 2500,
      tax_profile: "not-a-real-profile",
      entry_mode: "not-real",
    });

    expect(draft).toMatchObject({
      dealId: "deal-456",
      entryMode: "manual",
      taxProfile: "standard",
      tradeAllowance: 2500,
      selectedFinanceScenario: "Cash",
      cashDown: 0,
      amountFinanced: 0,
    });
    expect(draft.equipment).toEqual([
      {
        kind: "equipment",
        id: undefined,
        title: "ASV RT-135",
        make: "ASV",
        model: "RT-135",
        year: null,
        quantity: 1,
        unitPrice: 102000,
      },
    ]);
    expect(draft.attachments).toEqual([]);
  });
});
