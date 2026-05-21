import { describe, expect, test } from "bun:test";
import {
  buildQuoteListActionPayload,
  buildQuoteSavePayload,
  buildPortalRevisionQuoteData,
  buildQuoteListUrl,
  normalizeAvailabilityRequest,
  normalizeClosedDealsAudit,
  normalizeCrmEquipmentQuoteSeed,
  normalizeFactorAttributionDeals,
  normalizeFactorVerdicts,
  normalizePortalQuoteRevisionCompare,
  normalizePortalQuoteRevisionDraft,
  normalizePortalRevisionEnvelope,
  normalizePortalRevisionMutationResponse,
  normalizePortalRevisionPublishResponse,
  normalizePortalRevisionPublishState,
  normalizeQuoteApprovalCaseSummary,
  normalizeQuoteApprovalPolicy,
  normalizeQuoteApprovalSubmitResult,
  normalizeQuoteFinanceScenario,
  normalizeQuoteFinancingPreview,
  normalizeQuoteListActionResponse,
  normalizeQuoteListResponse,
  normalizeQuotePackageCatalogItem,
  normalizeQuoteRecommendation,
  normalizeQuoteSignatureResponse,
  normalizeScorerCalibrationObservations,
  normalizeSendQuotePackageResponse,
} from "../quote-api";
import type { QuoteWorkspaceDraft } from "../../../../../../../shared/qep-moonshot-contracts";

function makeQuoteDraft(overrides: Partial<QuoteWorkspaceDraft> = {}): QuoteWorkspaceDraft {
  return {
    entryMode: "manual",
    branchSlug: "lake-city",
    recommendation: null,
    voiceSummary: null,
    equipment: [{ kind: "equipment", title: "Bobcat E85", quantity: 1, unitPrice: 100_000 }],
    attachments: [],
    pricingLines: [],
    tradeAllowance: 0,
    tradeValuationId: null,
    commercialDiscountType: "flat",
    commercialDiscountValue: 0,
    cashDown: 0,
    taxProfile: "standard",
    taxTotal: 0,
    amountFinanced: 100_000,
    selectedFinanceScenario: null,
    customerName: "Walk-in prospect",
    customerCompany: "",
    customerPhone: "",
    customerEmail: "buyer@example.com",
    customerSignals: null,
    customerWarmth: null,
    quoteStatus: "draft",
    ...overrides,
  };
}

const computedQuoteTotals = {
  equipmentTotal: 100_000,
  attachmentTotal: 0,
  subtotal: 100_000,
  discountTotal: 1_000,
  discountedSubtotal: 99_000,
  netTotal: 99_000,
  taxTotal: 0,
  customerTotal: 99_000,
  cashDown: 0,
  amountFinanced: 99_000,
  marginAmount: 20_000,
  marginPct: 20,
};

describe("buildQuoteSavePayload", () => {
  test("marks walk-in prospect quotes without CRM ids", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({
        customerName: "Walk-in prospect",
        customerCompany: "Walk-in prospect",
        customerWarmth: "new",
        contactId: undefined,
        companyId: undefined,
      }),
      computedQuoteTotals,
      [],
    );

    expect(payload.is_prospect_quote).toBe(true);
    expect(payload.prospect_conversion_source).toEqual({
      original_customer_name: "Walk-in prospect",
      original_customer_company: "Walk-in prospect",
      original_customer_phone: null,
      original_customer_email: "buyer@example.com",
      conversion_status: "pending_crm_link",
    });
    expect(payload.customer_warmth).toBe("new");
    expect(payload.contact_id).toBeUndefined();
    expect(payload.company_id).toBeUndefined();
  });

  test("persists equipment override as equipment_override_price_cents", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({
        equipment: [{
          kind: "equipment",
          id: "model-1",
          title: "Bobcat T86",
          quantity: 1,
          unitPrice: 72_500,
          equipmentOverridePriceCents: 7_250_000,
          metadata: { system_base_unit_price: 75_000 },
        }],
      }),
      computedQuoteTotals,
      [],
    );

    const line = (payload.line_items as Array<Record<string, unknown>>)[0]!;
    expect(line.equipment_override_price_cents).toBe(7_250_000);
    expect(line.unit_price).toBe(72_500);
    expect((line.metadata as Record<string, unknown>).equipment_override_price).toBeUndefined();
    expect((line.metadata as Record<string, unknown>).system_base_unit_price).toBe(75_000);
  });

  test("preserves availability request metadata on equipment line items", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({
        equipment: [{
          kind: "equipment",
          id: "model-1",
          sourceCatalog: "qb_equipment_models",
          sourceId: "11111111-1111-4111-8111-111111111111",
          title: "Bobcat T86",
          make: "Bobcat",
          model: "T86",
          year: 2026,
          quantity: 1,
          unitPrice: 75_000,
          metadata: {
            availability_status: "source_required",
            availability_request_id: "22222222-2222-4222-8222-222222222222",
            availability_request_status: "pending",
            availability_client_line_key: "qb_equipment_models|model-1|0",
            photo_url: "https://cdn.qep.example/t86-front.jpg",
            photo_urls: ["https://cdn.qep.example/t86-front.jpg", "https://cdn.qep.example/t86-side.jpg"],
            media_source: "crm_equipment",
            media_source_id: "asset-1",
            media_kind: "actual",
            serial_number: "B4CD12345",
          },
        }],
      }),
      computedQuoteTotals,
      [],
    );

    const line = (payload.line_items as Array<{ metadata: Record<string, unknown> }>)[0]!;
    expect(line.metadata.availability_request_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(line.metadata.availability_request_status).toBe("pending");
    expect(line.metadata.source_catalog).toBe("qb_equipment_models");
    expect(line.metadata.source_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(line.metadata.photo_url).toBe("https://cdn.qep.example/t86-front.jpg");
    expect(line.metadata.photo_urls).toEqual(["https://cdn.qep.example/t86-front.jpg", "https://cdn.qep.example/t86-side.jpg"]);
    expect(line.metadata.media_source).toBe("crm_equipment");
    expect(line.metadata.media_kind).toBe("actual");
    expect(line.metadata.serial_number).toBe("B4CD12345");
  });

  test("preserves structured manufacturer specs in saved quote-line metadata", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({
        equipment: [{
          kind: "equipment",
          id: "model-1",
          sourceCatalog: "qb_equipment_models",
          sourceId: "11111111-1111-4111-8111-111111111111",
          title: "ASV RT-75",
          make: "ASV",
          model: "RT-75",
          year: 2026,
          quantity: 1,
          unitPrice: 92_000,
          metadata: {
            spec_bullets: ["Horsepower: 74 HP"],
            structured_specs: [{
              key: "horsepower",
              label: "Horsepower",
              value: "74",
              unit: "HP",
              category: "Engine",
              priority: 10,
              source: "qb_equipment_models.specs",
            }],
            spec_source: "manufacturer_ingested",
          },
        }],
      }),
      computedQuoteTotals,
      [],
    );

    const line = (payload.line_items as Array<{ metadata: Record<string, unknown> }>)[0]!;
    expect(line.metadata.structured_specs).toEqual([expect.objectContaining({ key: "horsepower", value: "74" })]);
    expect(line.metadata.spec_bullets).toEqual(["Horsepower: 74 HP"]);
    expect(line.metadata.spec_source).toBe("manufacturer_ingested");
  });

  test("does not persist placeholder promotion ids or promotion marker reason codes", () => {
    const realPromotionId = "11111111-1111-4111-8111-111111111111";
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({
        selectedPromotionIds: ["seed-mfg-support", realPromotionId],
        pricingLines: [
          {
            kind: "rebate_mfg",
            id: "rebate_mfg-1",
            title: "Manufacturer retail support",
            quantity: 1,
            unitPrice: 1_000,
            reasonCode: "seed-mfg-support",
            metadata: { promotion_placeholder_id: "seed-mfg-support" },
          },
          {
            kind: "discount",
            id: "discount-1",
            title: "Manual discount",
            quantity: 1,
            unitPrice: 500,
            reasonCode: "competitive_match",
          },
        ],
      }),
      computedQuoteTotals,
      [],
    );

    expect(payload.selected_promotion_ids).toEqual([realPromotionId]);
    const lines = payload.line_items as Array<Record<string, unknown>>;
    expect(lines.find((line) => line.line_type === "rebate_mfg")?.reason_code).toBeUndefined();
    expect(lines.find((line) => line.line_type === "discount")?.reason_code).toBe("competitive_match");
  });

  test("serializes APR source attribution with financing scenarios", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({ selectedFinanceScenario: "QEP Finance 60", showFinanceComparisonOnCustomerCopy: false }),
      computedQuoteTotals,
      [{
        type: "finance",
        kind: "finance",
        label: "QEP Finance 60",
        termMonths: 60,
        apr: 6.5,
        monthlyPayment: 1999.42,
        totalCost: 119_965.2,
        lender: "Preferred lender",
        aprSource: {
          kind: "manufacturer_program",
          label: "Yanmar Spring APR program",
          provider: "Yanmar",
          programId: "YAN-APR-2026",
          effectiveFrom: "2026-04-01",
        },
      }],
    );

    expect(payload.show_finance_comparison_on_customer_copy).toBe(false);
    const scenarios = payload.financing_scenarios as Array<Record<string, unknown>>;
    expect(scenarios[0]?.show_finance_comparison_on_customer_copy).toBe(false);
    expect(scenarios[0]?.apr_source).toEqual({
      kind: "manufacturer_program",
      label: "Yanmar Spring APR program",
      provider: "Yanmar",
      programId: "YAN-APR-2026",
      effectiveFrom: "2026-04-01",
    });
  });

  test("persists customer comparison toggle even without financing scenarios", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({ showFinanceComparisonOnCustomerCopy: false }),
      computedQuoteTotals,
      [],
    );

    expect(payload.show_finance_comparison_on_customer_copy).toBe(false);
    expect(payload.financing_scenarios).toEqual([]);
  });

  test("maps inbound and outbound freight amounts from pricing metadata", () => {
    const payload = buildQuoteSavePayload(
      makeQuoteDraft({
        pricingLines: [
          {
            kind: "freight",
            id: "freight-inbound",
            title: "Inbound freight to yard",
            quantity: 1,
            unitPrice: 1800,
            metadata: {
              pricing_field_key: "inbound_freight",
              freight_direction: "inbound",
            },
          },
          {
            kind: "freight",
            id: "freight-outbound",
            title: "Outbound delivery",
            quantity: 1,
            unitPrice: 2400,
            costVisibility: "customer",
            metadata: {
              pricing_field_key: "outbound_delivery",
              freight_direction: "outbound",
            },
          },
        ],
      }),
      computedQuoteTotals,
      [],
    );

    const freightLines = (payload.line_items as Array<Record<string, unknown>>)
      .filter((line) => line.line_type === "freight");
    expect(freightLines.length).toBe(2);
    expect(freightLines.find((line) => line.id === "freight-inbound")?.cost_visibility).toBe("internal");
    expect(freightLines.find((line) => line.id === "freight-inbound")?.inbound_freight_amount).toBe(1800);
    expect(freightLines.find((line) => line.id === "freight-inbound")?.outbound_delivery_amount).toBeUndefined();
    expect(freightLines.find((line) => line.id === "freight-outbound")?.outbound_delivery_amount).toBe(2400);
    expect(freightLines.find((line) => line.id === "freight-outbound")?.inbound_freight_amount).toBeUndefined();
  });
});

describe("normalizeCrmEquipmentQuoteSeed", () => {
  test("maps real CRM equipment photos into quote-builder catalog metadata", () => {
    const seed = normalizeCrmEquipmentQuoteSeed({
      id: "11111111-1111-4111-8111-111111111111",
      name: "ASV RT-135F Forestry",
      make: "ASV",
      model: "RT-135F",
      year: 2026,
      asset_tag: "Q003403",
      serial_number: "ASVRT135LTDF01723",
      condition: "new",
      availability: "available",
      current_market_value: 144_110.65,
      replacement_cost: 148_950,
      engine_hours: 4.2,
      fuel_type: "Diesel",
      operating_capacity: "4,150 lb ROC",
      photo_urls: [
        "https://storage.qep.example/equipment/asv-front.jpg",
        "https://storage.qep.example/equipment/asv-side.jpg",
      ],
      warranty_expires_on: "2028-05-07",
      metadata: { vendor_logo_url: "https://cdn.qep.example/asv-logo.png" },
    });

    expect(seed).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      sourceCatalog: "catalog_entries",
      sourceId: "11111111-1111-4111-8111-111111111111",
      make: "ASV",
      model: "RT-135F",
      year: 2026,
      list_price: 148_950,
      stock_number: "Q003403",
      serial_number: "ASVRT135LTDF01723",
      photo_url: "https://storage.qep.example/equipment/asv-front.jpg",
      photo_urls: [
        "https://storage.qep.example/equipment/asv-front.jpg",
        "https://storage.qep.example/equipment/asv-side.jpg",
      ],
      media_source: "crm_equipment",
      media_source_id: "11111111-1111-4111-8111-111111111111",
      media_kind: "actual",
      availabilityStatus: "in_stock",
      vendor_logo_url: "https://cdn.qep.example/asv-logo.png",
      received_at: null,
      hot_list: false,
    });
    expect(seed?.spec_bullets).toContain("4.2 hours");
    expect(seed?.spec_bullets).toContain("Fuel type: Diesel");
    expect(seed?.spec_bullets).toContain("Operating capacity: 4,150 lb ROC");
  });

  test("maps yard receipt timestamps from CRM metadata for approval bypass rules", () => {
    const seed = normalizeCrmEquipmentQuoteSeed({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Demo unit",
      make: "Bobcat",
      model: "T66",
      year: 2024,
      availability: "available",
      metadata: { received_at: "2023-06-15T12:00:00.000Z" },
    });
    expect(seed?.received_at).toBe("2023-06-15T12:00:00.000Z");
    expect(seed?.hot_list).toBe(false);
  });

  test("maps hot list flags from CRM metadata for approval bypass rules", () => {
    expect(
      normalizeCrmEquipmentQuoteSeed({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Hot mover",
        make: "Cat",
        model: "299D3",
        year: 2023,
        availability: "available",
        metadata: { on_hot_list: true },
      })?.hot_list,
    ).toBe(true);
    expect(
      normalizeCrmEquipmentQuoteSeed({
        id: "44444444-4444-4444-8444-444444444444",
        name: "Not hot",
        make: "Cat",
        model: "259D3",
        year: 2023,
        availability: "available",
        metadata: { hot_list: "false" },
      })?.hot_list,
    ).toBe(false);
  });
});

describe("normalizeQuoteFinanceScenario", () => {
  test("maps snake_case backend fields into the shared frontend contract", () => {
    const scenario = normalizeQuoteFinanceScenario({
      type: "finance",
      term_months: 60,
      rate: 6.5,
      monthly_payment: 1999.42,
      total_cost: 119_965.2,
      lender: "Preferred lender",
      apr_source: {
        kind: "manufacturer_program",
        label: "Yanmar Spring APR program",
        provider: "Yanmar",
        effective_from: "2026-04-01",
      },
    });

    expect(scenario.label).toBe("Finance 60 mo");
    expect(scenario.termMonths).toBe(60);
    expect(scenario.apr).toBe(6.5);
    expect(scenario.monthlyPayment).toBe(1999.42);
    expect(scenario.totalCost).toBe(119_965.2);
    expect(scenario.aprSource).toEqual({
      kind: "manufacturer_program",
      label: "Yanmar Spring APR program",
      provider: "Yanmar",
      programId: null,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      disclosure: null,
    });
  });

  test("normalizes flat APR source fields", () => {
    const scenario = normalizeQuoteFinanceScenario({
      type: "finance",
      apr_source_label: "Dealer rate sheet",
      apr_source_kind: "dealer_program",
      apr_source_provider: "QEP Finance Desk",
      apr_source_program_id: "QEP-60",
      apr_source_effective_from: "2026-05-01",
    });

    expect(scenario.aprSource).toMatchObject({
      kind: "dealer_program",
      label: "Dealer rate sheet",
      provider: "QEP Finance Desk",
      programId: "QEP-60",
      effectiveFrom: "2026-05-01",
    });
  });

  test("does not treat lender-only scenario data as APR source attribution", () => {
    const scenario = normalizeQuoteFinanceScenario({
      type: "finance",
      label: "Finance 60",
      lender: "Preferred lender",
      apr: 7.25,
    });

    expect(scenario.lender).toBe("Preferred lender");
    expect(scenario.aprSource).toBeNull();
  });
});

describe("buildPortalRevisionQuoteData", () => {
  test("filters disabled leases and hidden comparison options", () => {
    const quoteData = buildPortalRevisionQuoteData(
      makeQuoteDraft({
        selectedFinanceScenario: "60 months",
        showFinanceComparisonOnCustomerCopy: false,
      }),
      {
        subtotal: 100_000,
        discountTotal: 0,
        netTotal: 100_000,
        taxTotal: 0,
        customerTotal: 100_000,
        cashDown: 0,
        amountFinanced: 100_000,
      },
      [
        { type: "cash", kind: "cash", label: "Cash", totalCost: 100_000 },
        { type: "finance", kind: "finance", label: "60 months", monthlyPayment: 2_050, termMonths: 60, apr: 7.25, lender: "Preferred lender" },
        { type: "lease", kind: "lease_fmv", label: "FMV lease", monthlyPayment: 1_850, termMonths: 48, apr: 6.9 },
      ],
      null,
      null,
      { includeLeaseScenarios: false },
    );

    expect(quoteData.financeComparisonEnabled).toBe(false);
    expect((quoteData.financing as Array<Record<string, unknown>>).map((scenario) => scenario.lender ?? scenario.type)).toEqual(["Preferred lender"]);
    expect(JSON.stringify(quoteData)).not.toContain("FMV lease");
    expect(JSON.stringify(quoteData)).not.toContain("Cash");
  });
});

describe("package item catalog helpers", () => {
  test("normalizes option rows into quote package catalog items", () => {
    const item = normalizeQuotePackageCatalogItem({
      id: "option-1",
      name: "Hydraulic thumb kit",
      category: "Excavator options",
      list_price_cents: 480000,
      dealer_cost_cents: 310000,
      universal: false,
      brand: { name: "QEP", category: "Attachments" },
    }, "option");

    expect(item).toEqual({
      id: "option-1",
      kind: "option",
      name: "Hydraulic thumb kit",
      price: 4800,
      dealerCost: 3100,
      brandName: "QEP",
      category: "Excavator options",
      universal: false,
      sourceCatalog: "manual",
      sourceId: "option-1",
      metadata: {
        catalog_kind: "option",
        source: "qb_package_items",
        term_months: null,
        compatibility: "catalog_match",
      },
    });
  });

  test("normalizes warranty term metadata and direct prices", () => {
    const item = normalizeQuotePackageCatalogItem({
      id: "warranty-60",
      title: "Premier protection plan",
      price: 4250,
      warranty_term_months: 60,
      universal: true,
    }, "warranty");

    expect(item?.kind).toBe("warranty");
    expect(item?.price).toBe(4250);
    expect(item?.universal).toBe(true);
    expect(item?.metadata?.term_months).toBe(60);
    expect(item?.metadata?.compatibility).toBe("universal");
  });

  test("rejects package rows without ids or names", () => {
    expect(normalizeQuotePackageCatalogItem({ id: "missing-name" }, "accessory")).toBeNull();
    expect(normalizeQuotePackageCatalogItem({ name: "Missing id" }, "accessory")).toBeNull();
  });
});

describe("quote list API helpers", () => {
  test("buildQuoteListUrl encodes search and omits all status", () => {
    const url = buildQuoteListUrl({ status: "all", search: "QEP 0002 & DFW" });

    expect(url).toContain("/quote-builder-v2/list?");
    expect(url).toContain("search=QEP+0002+%26+DFW");
    expect(url).not.toContain("status=all");
  });

  test("buildQuoteListUrl includes specific status filters", () => {
    const url = buildQuoteListUrl({ status: "sent" });

    expect(url).toContain("/quote-builder-v2/list?");
    expect(url).toContain("status=sent");
  });

  test("buildQuoteListActionPayload uses backend snake_case contract", () => {
    expect(buildQuoteListActionPayload({ quotePackageId: "quote-1", action: "archive" })).toEqual({
      quote_package_id: "quote-1",
      action: "archive",
    });
  });

  test("normalizeQuoteListResponse filters malformed items and preserves valid rows", () => {
    const normalized = normalizeQuoteListResponse({
      items: [
        {
          id: "quote-1",
          quote_number: "Q-1001",
          customer_name: "Sam Green",
          customer_company: "Green Farms",
          contact_name: null,
          status: "sent",
          net_total: "125000",
          equipment_summary: "8R Tractor",
          entry_mode: "manual",
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-02T00:00:00Z",
          accepted_at: null,
          win_probability_score: "81",
        },
        { quote_number: "missing-id" },
        null,
      ],
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.id).toBe("quote-1");
    expect(normalized.items[0]?.net_total).toBe(125000);
    expect(normalized.items[0]?.win_probability_score).toBe(81);
    expect(normalized.items[0]?.is_prospect_quote).toBe(false);
  });

  test("normalizeQuoteListItem treats is_prospect_quote as strict boolean", () => {
    const normalized = normalizeQuoteListResponse({
      items: [
        {
          id: "quote-p",
          quote_number: null,
          customer_name: "Pat",
          customer_company: null,
          contact_name: null,
          status: "sent",
          net_total: 0,
          equipment_summary: "Skid",
          entry_mode: null,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-02T00:00:00Z",
          accepted_at: null,
          win_probability_score: null,
          is_prospect_quote: true,
        },
      ],
    });
    expect(normalized.items[0]?.is_prospect_quote).toBe(true);
  });

  test("normalizeQuoteListActionResponse normalizes optional quote payload", () => {
    const normalized = normalizeQuoteListActionResponse({
      ok: true,
      quote: {
        id: "quote-2",
        status: "archived",
        equipment_summary: "Compact tractor",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-02T00:00:00Z",
      },
    });

    expect(normalized.ok).toBe(true);
    expect(normalized.quote?.id).toBe("quote-2");
    expect(normalized.quote?.customer_name).toBeNull();
  });
});

describe("quote edge analytics normalizers", () => {
  test("normalizeScorerCalibrationObservations filters bad rows", () => {
    const observations = normalizeScorerCalibrationObservations({
      observations: [
        { score: "74", outcome: "won" },
        { score: 20, outcome: "skipped" },
        { score: "bad", outcome: "lost" },
      ],
    });

    expect(observations).toEqual([{ score: 74, outcome: "won" }]);
  });

  test("normalizeFactorAttributionDeals keeps valid outcomes and cleans factors", () => {
    const deals = normalizeFactorAttributionDeals({
      deals: [
        {
          outcome: "lost",
          factors: [
            { label: "Price pressure", weight: "-8" },
            { label: "", weight: 4 },
            { label: "No weight" },
          ],
        },
        { outcome: "skipped", factors: [{ label: "Ignored", weight: 1 }] },
      ],
    });

    expect(deals).toEqual([
      { outcome: "lost", factors: [{ label: "Price pressure", weight: -8 }] },
    ]);
  });

  test("normalizeFactorVerdicts builds a safe verdict map", () => {
    const verdicts = normalizeFactorVerdicts({
      verdicts: [
        { label: "Fast follow-up", verdict: "proven" },
        { label: "Bad verdict", verdict: "maybe" },
        { label: "", verdict: "suspect" },
      ],
    });

    expect(verdicts.size).toBe(1);
    expect(verdicts.get("Fast follow-up")).toBe("proven");
  });

  test("normalizeClosedDealsAudit supports camel and snake case timestamps", () => {
    const audits = normalizeClosedDealsAudit({
      audits: [
        {
          package_id: "pkg-1",
          score: "88",
          outcome: "expired",
          factors: [{ label: "Aging quote", weight: "7" }],
          captured_at: "2026-05-02T00:00:00Z",
        },
        { packageId: "", score: 20, outcome: "won", factors: [] },
      ],
    });

    expect(audits).toEqual([
      {
        packageId: "pkg-1",
        score: 88,
        outcome: "expired",
        factors: [{ label: "Aging quote", weight: 7 }],
        capturedAt: "2026-05-02T00:00:00Z",
      },
    ]);
  });
});

describe("normalizeQuoteFinancingPreview", () => {
  test("normalizes the full preview envelope", () => {
    const preview = normalizeQuoteFinancingPreview({
      scenarios: [
        { type: "cash", label: "Cash", total_cost: 95_500 },
        { type: "lease", term_months: 48, apr: 5.25, monthly_payment: 1800, total_cost: 110_000 },
      ],
      amount_financed: 75_500,
      tax_total: 4_500,
      customer_total: 95_500,
      discount_total: 11_500,
      margin_check: { flagged: true, message: "Margin below 10%" },
      incentives: {
        applicable: [{ id: "inc-1", name: "Spring Cash", discount_type: "cash", discount_value: 2_500, estimated_savings: 2_500 }],
        total_savings: 2_500,
      },
    });

    expect(preview.scenarios).toHaveLength(2);
    expect(preview.amountFinanced).toBe(75_500);
    expect(preview.taxTotal).toBe(4_500);
    expect(preview.customerTotal).toBe(95_500);
    expect(preview.discountTotal).toBe(11_500);
    expect(preview.margin_check?.message).toBe("Margin below 10%");
    expect(preview.incentives?.total_savings).toBe(2_500);
  });
});

describe("quote recommendation and send normalizers", () => {
  test("normalizes availability request envelopes with candidates", () => {
    const request = normalizeAvailabilityRequest({
      id: "req-1",
      quote_package_id: "pkg-1",
      quote_line_item_id: null,
      catalog_model_id: "model-1",
      client_line_key: "line-1",
      requested_by: "user-1",
      requested_by_name: "Brian",
      status: "pending",
      urgency: "rush",
      requested_machine_label: "Bobcat T86",
      requested_budget: "75000",
      metadata: { source: "quote_builder_v2" },
      candidates: [
        {
          id: "cand-1",
          request_id: "req-1",
          candidate_type: "exact_catalog_model",
          catalog_model_id: "model-1",
          score: "80",
          availability_status: "source_required",
          estimated_cost: 75000,
          selected_at: "2026-05-07T15:05:00Z",
          source_confidence: "high",
          customer_safe_label: "Bobcat T86 available path",
          metadata: { ok: true },
          model: { model_code: "T86" },
        },
        { missing: "id" },
      ],
      events: [
        {
          id: "event-1",
          request_id: "req-1",
          actor_name: "Ops Manager",
          event_type: "requested",
          to_status: "pending",
          note: "Request created",
          metadata: { source: "quote_builder_v2" },
          created_at: "2026-05-07T15:01:00Z",
        },
        { missing: "id" },
      ],
      priority_score: "50",
      sla_due_at: "2026-05-07T17:00:00Z",
      manager_override_at: "2026-05-07T16:00:00Z",
      manager_override_reason: "Customer accepts sourcing risk",
      created_at: "2026-05-07T15:00:00Z",
    });

    expect(request?.id).toBe("req-1");
    expect(request?.requestedMachineLabel).toBe("Bobcat T86");
    expect(request?.requestedBudget).toBe(75000);
    expect(request?.priorityScore).toBe(50);
    expect(request?.managerOverrideReason).toBe("Customer accepts sourcing risk");
    expect(request?.candidates).toHaveLength(1);
    expect(request?.candidates[0]?.candidateType).toBe("exact_catalog_model");
    expect(request?.candidates[0]?.selectedAt).toBe("2026-05-07T15:05:00Z");
    expect(request?.candidates[0]?.customerSafeLabel).toBe("Bobcat T86 available path");
    expect(request?.events).toHaveLength(1);
    expect(request?.events[0]?.eventType).toBe("requested");
  });

  test("normalizes AI recommendation envelopes and filters malformed nested rows", () => {
    const recommendation = normalizeQuoteRecommendation({
      recommendation: {
        machine: "  8R 310  ",
        attachments: ["Loader", "", 42, "Bale spear"],
        reasoning: "Fits acreage and loader work.",
        trigger: {
          triggerType: "unexpected",
          sourceField: "voice_transcript",
          excerpt: "Customer needs hay handling",
          createdAt: "2026-05-03T12:00:00Z",
        },
        alternative: {
          machine: "6R 250",
          attachments: ["Mower", null],
          reasoning: "Lower price point.",
          whyNotChosen: "Less fit for heavy loader work.",
        },
        jobConsiderations: ["Hay", "", "Loader work"],
        jobFacts: [
          { label: "Acreage", value: "400" },
          { label: "", value: "ignored" },
        ],
        transcriptHighlights: [
          { quote: "Need to move round bales", supports: "loader spec" },
          { quote: "", supports: "ignored" },
        ],
      },
    });

    expect(recommendation.machine).toBe("8R 310");
    expect(recommendation.attachments).toEqual(["Loader", "Bale spear"]);
    expect(recommendation.trigger?.triggerType).toBe("voice_transcript");
    expect(recommendation.alternative?.attachments).toEqual(["Mower"]);
    expect(recommendation.jobConsiderations).toEqual(["Hay", "Loader work"]);
    expect(recommendation.jobFacts).toEqual([{ label: "Acreage", value: "400" }]);
    expect(recommendation.transcriptHighlights).toEqual([
      { quote: "Need to move round bales", supports: "loader spec" },
    ]);
  });

  test("normalizes send-package edge responses", () => {
    expect(normalizeSendQuotePackageResponse({
      sent: true,
      toEmail: "buyer@example.com",
      shareToken: "share-1",
      publicUrl: "https://example.com/q/share-1",
      deliveryEventId: "event-1",
      pdfVersionNumber: "3",
      documentArtifactId: "artifact-1",
    })).toEqual({
      sent: true,
      to_email: "buyer@example.com",
      share_token: "share-1",
      public_url: "https://example.com/q/share-1",
      delivery_event_id: "event-1",
      pdf_version_number: 3,
      document_artifact_id: "artifact-1",
    });
    expect(normalizeSendQuotePackageResponse({ sent: "yes", to_email: 42 })).toEqual({
      sent: false,
      to_email: "",
      share_token: null,
      public_url: null,
      delivery_event_id: null,
      pdf_version_number: null,
      document_artifact_id: null,
    });
  });
});

describe("quote approval normalizers", () => {
  test("normalizes submit approval responses from snake case payloads", () => {
    const result = normalizeQuoteApprovalSubmitResult({
      approval_case_id: "case-1",
      approval_id: "flow-1",
      quote_package_version_id: "version-1",
      version_number: "7",
      branch_name: "Raleigh",
      assigned_to_name: "Sales Manager",
      route_mode: "owner_direct",
      already_pending: true,
    });

    expect(result).toEqual({
      approvalCaseId: "case-1",
      approvalId: "flow-1",
      quotePackageVersionId: "version-1",
      versionNumber: 7,
      status: "pending_approval",
      branchName: "Raleigh",
      assignedToName: "Sales Manager",
      routeMode: "owner_direct",
      alreadyPending: true,
      bypassRuleId: null,
      bypassRuleName: null,
      autoSend: null,
    });
  });

  test("normalizes bypass auto-approval responses", () => {
    const result = normalizeQuoteApprovalSubmitResult({
      status: "approved",
      bypass_rule_id: "rule-1",
      bypass_rule_name: "Aged stocked inventory auto-approve",
    });

    expect(result.status).toBe("approved");
    expect(result.bypassRuleId).toBe("rule-1");
    expect(result.bypassRuleName).toBe("Aged stocked inventory auto-approve");
    expect(result.autoSend).toBeNull();
  });

  test("normalizes bypass responses with approved_with_conditions status", () => {
    const result = normalizeQuoteApprovalSubmitResult({
      status: "approved_with_conditions",
      bypass_rule_id: "rule-2",
      bypass_rule_name: "Hot list fast path",
    });
    expect(result.status).toBe("approved_with_conditions");
    expect(result.bypassRuleId).toBe("rule-2");
    expect(result.bypassRuleName).toBe("Hot list fast path");
  });

  test("normalizes auto-send outcomes from submit approval responses", () => {
    const result = normalizeQuoteApprovalSubmitResult({
      status: "approved",
      auto_send: {
        attempted: true,
        sent: false,
        reason: "auto_send_not_sent",
        error: "Email service not configured",
      },
    });

    expect(result.autoSend).toEqual({
      attempted: true,
      sent: false,
      reason: "auto_send_not_sent",
      error: "Email service not configured",
    });
  });

  test("normalizes approval case summaries and drops malformed nested rows", () => {
    const summary = normalizeQuoteApprovalCaseSummary({
      id: "case-1",
      quote_package_id: "quote-1",
      quote_package_version_id: "version-1",
      version_number: "3",
      deal_id: "deal-1",
      branch_slug: "raleigh",
      branch_name: "Raleigh",
      submitted_by_name: "Rep",
      assigned_role: "manager",
      route_mode: "unknown",
      policy_snapshot: { floor: 12 },
      reason_summary: { margin: "low" },
      status: "approved_with_conditions",
      decision_note: "Fix cash down",
      due_at: "2026-05-04T12:00:00Z",
      flow_approval_id: "flow-1",
      conditions: [
        {
          id: "condition-1",
          approval_case_id: "case-1",
          condition_type: "required_cash_down",
          condition_payload: { amount: 5000 },
          sort_order: "2",
          created_at: "2026-05-03T12:00:00Z",
        },
        { condition_type: "min_margin_pct" },
      ],
      evaluations: [
        {
          id: "evaluation-1",
          condition_type: "bad-type",
          label: "Cash down",
          satisfied: true,
          detail: "Met",
          blocking: false,
        },
        { label: "missing id" },
      ],
      can_send: true,
    });

    expect(summary?.routeMode).toBe("manager_queue");
    expect(summary?.status).toBe("approved_with_conditions");
    expect(summary?.versionNumber).toBe(3);
    expect(summary?.conditions).toEqual([
      {
        id: "condition-1",
        approvalCaseId: "case-1",
        conditionType: "required_cash_down",
        conditionPayload: { amount: 5000 },
        sortOrder: 2,
        createdAt: "2026-05-03T12:00:00Z",
      },
    ]);
    expect(summary?.evaluations).toEqual([
      {
        id: "evaluation-1",
        conditionType: "min_margin_pct",
        label: "Cash down",
        satisfied: true,
        detail: "Met",
        blocking: false,
      },
    ]);
    expect(summary?.canSend).toBe(true);
  });

  test("rejects incomplete approval case summaries", () => {
    expect(normalizeQuoteApprovalCaseSummary({ id: "case-1" })).toBeNull();
  });

  test("normalizes approval policies from camel and snake case payloads", () => {
    const policy = normalizeQuoteApprovalPolicy({
      workspace_id: "workspace-1",
      branch_manager_min_margin_pct: "9.5",
      standard_margin_floor_pct: 12,
      branch_manager_max_quote_amount: "250000",
      submit_sla_hours: "8",
      escalation_sla_hours: "24",
      owner_escalation_role: "admin",
      named_branch_sales_manager_primary: true,
      named_branch_general_manager_fallback: false,
      allowed_condition_types: ["required_cash_down", "bad-type", "expiry_hours"],
      updated_at: "2026-05-03T12:00:00Z",
      updated_by: "admin-1",
    });

    expect(policy.workspaceId).toBe("workspace-1");
    expect(policy.branchManagerMinMarginPct).toBe(9.5);
    expect(policy.branchManagerMaxQuoteAmount).toBe(250000);
    expect(policy.ownerEscalationRole).toBe("admin");
    // Omitted authority_band falls back to the safe legacy default so
    // policies written before migration 555 keep their behaviour.
    expect(policy.authorityBand).toBe("owner_admin");
    expect(policy.allowedConditionTypes).toEqual([
      "required_cash_down",
      "min_margin_pct",
      "expiry_hours",
    ]);
    expect(policy.updatedBy).toBe("admin-1");
  });

  test("normalizes authority_band override into the camelCase contract", () => {
    const policy = normalizeQuoteApprovalPolicy({
      workspace_id: "workspace-2",
      authority_band: "branch_manager",
    });
    expect(policy.authorityBand).toBe("branch_manager");
  });
});

describe("quote portal revision normalizers", () => {
  const draftPayload = {
    id: "draft-1",
    portal_quote_review_id: "review-1",
    quote_package_id: "quote-1",
    deal_id: "deal-1",
    prepared_by: "rep-1",
    approved_by: null,
    status: "awaiting_approval",
    quote_data: { subtotal: 100000 },
    quote_pdf_url: "https://example.com/quote.pdf",
    dealer_message: "Updated attachment package.",
    revision_summary: "Attachment revision",
    customer_request_snapshot: "Customer asked for alternate loader.",
    compare_snapshot: {
      has_changes: true,
      price_changes: ["Subtotal changed", "", 12],
      equipment_changes: ["Loader added"],
      financing_changes: null,
      terms_changes: ["Subject to approval"],
      dealer_message_change: "Message updated",
    },
    created_at: "2026-05-03T12:00:00Z",
    updated_at: "2026-05-03T13:00:00Z",
    published_at: null,
  };

  const publishStatePayload = {
    portal_quote_review_id: "review-1",
    current_published_version_number: "4",
    current_published_dealer_message: "Current dealer message",
    current_published_revision_summary: "Current summary",
    latest_customer_request_snapshot: "Customer request",
    publication_status: "awaiting_approval",
  };

  test("normalizes compare snapshots with safe arrays", () => {
    expect(normalizePortalQuoteRevisionCompare(draftPayload.compare_snapshot)).toEqual({
      hasChanges: true,
      priceChanges: ["Subtotal changed"],
      equipmentChanges: ["Loader added"],
      financingChanges: [],
      termsChanges: ["Subject to approval"],
      dealerMessageChange: "Message updated",
    });
  });

  test("normalizes portal revision drafts and publish state from snake case payloads", () => {
    const draft = normalizePortalQuoteRevisionDraft(draftPayload);
    const publishState = normalizePortalRevisionPublishState(publishStatePayload);

    expect(draft?.portalQuoteReviewId).toBe("review-1");
    expect(draft?.quoteData).toEqual({ subtotal: 100000 });
    expect(draft?.status).toBe("awaiting_approval");
    expect(draft?.compareSnapshot?.priceChanges).toEqual(["Subtotal changed"]);
    expect(publishState?.currentPublishedVersionNumber).toBe(4);
    expect(publishState?.publicationStatus).toBe("awaiting_approval");
  });

  test("normalizes portal revision envelopes and preserves legacy review casing", () => {
    const envelope = normalizePortalRevisionEnvelope({
      review: {
        id: "review-1",
        status: "open",
        counter_notes: "Need revision",
        current_version: {
          version_number: "3",
          dealer_message: "Published message",
          revision_summary: "Published summary",
        },
      },
      draft: draftPayload,
      publishState: publishStatePayload,
    });

    expect(envelope.review?.current_version?.version_number).toBe(3);
    expect(envelope.review?.current_version?.dealer_message).toBe("Published message");
    expect(envelope.draft?.id).toBe("draft-1");
    expect(envelope.publishState?.portalQuoteReviewId).toBe("review-1");
  });

  test("fails fast on malformed portal mutation responses", () => {
    expect(() => normalizePortalRevisionMutationResponse({ draft: draftPayload })).toThrow(
      "Portal revision response was malformed.",
    );
    expect(() => normalizePortalRevisionPublishResponse({ draft: draftPayload })).toThrow(
      "Portal revision publish response was malformed.",
    );
  });

  test("normalizes portal mutation and publish responses", () => {
    expect(normalizePortalRevisionMutationResponse({
      draft: draftPayload,
      publishState: publishStatePayload,
    }).draft.id).toBe("draft-1");

    expect(normalizePortalRevisionPublishResponse({
      draft: null,
      publishState: publishStatePayload,
    }).draft).toBeNull();
  });

  test("normalizes signature responses to records only", () => {
    expect(normalizeQuoteSignatureResponse({ ok: true, id: "signature-1" })).toEqual({
      ok: true,
      id: "signature-1",
    });
    expect(normalizeQuoteSignatureResponse(null)).toEqual({});
  });
});
