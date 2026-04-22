import { describe, expect, test } from "bun:test";
import {
  buildDraftFromSummary,
  countMissingMappings,
  extractQuickBooksCompanyCard,
  quickBooksSetupHeadline,
  quickBooksSetupTone,
  type QuickBooksConfigSummary,
} from "./quickbooks-config-utils";

const readySummary: QuickBooksConfigSummary = {
  integration: {
    display_name: "QuickBooks Online GL",
    status: "connected",
    last_test_success: true,
    last_test_error: null,
    last_sync_error: null,
    updated_at: "2026-04-22T15:00:00.000Z",
  },
  config: {
    client_id: "client-123",
    realm_id: "realm-123",
    environment: "production",
    has_client_secret: true,
    has_refresh_token: true,
    account_ids: {
      ar_account_id: "100",
      service_revenue_account_id: "200",
      parts_revenue_account_id: "201",
      haul_revenue_account_id: "202",
      shop_supplies_account_id: "203",
      misc_revenue_account_id: "299",
      tax_liability_account_id: "300",
    },
    credential_count: 4,
    account_mapping_count: 7,
    core_ready: true,
    ready_for_sync: true,
  },
};

describe("quickbooks-config-utils", () => {
  test("builds a draft from existing non-secret config", () => {
    const draft = buildDraftFromSummary(readySummary);
    expect(draft.client_id).toBe("client-123");
    expect(draft.realm_id).toBe("realm-123");
    expect(draft.client_secret).toBe("");
    expect(draft.refresh_token).toBe("");
  });

  test("reports missing mapping counts and setup tone", () => {
    expect(countMissingMappings(readySummary)).toBe(0);
    expect(quickBooksSetupTone(readySummary)).toBe("healthy");
    expect(quickBooksSetupHeadline(readySummary)).toBe("Ready to post journal entries");

    const incomplete = {
      ...readySummary,
      config: {
        ...readySummary.config,
        account_mapping_count: 4,
        ready_for_sync: false,
      },
    };
    expect(countMissingMappings(incomplete)).toBe(3);
    expect(quickBooksSetupTone(incomplete)).toBe("warning");
  });

  test("extracts a company card from QuickBooks company info payload", () => {
    expect(
      extractQuickBooksCompanyCard({
        CompanyInfo: {
          CompanyName: "QEP Demo Company",
          LegalName: "Quality Equipment & Parts LLC",
          Country: "US",
          WebAddr: "https://qualityequipmentparts.netlify.app",
        },
      }),
    ).toEqual({
      companyName: "QEP Demo Company",
      legalName: "Quality Equipment & Parts LLC",
      country: "US",
      webAddr: "https://qualityequipmentparts.netlify.app",
    });
  });
});
