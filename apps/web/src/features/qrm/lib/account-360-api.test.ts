import { describe, expect, it } from "bun:test";
import {
  normalizeIntelliDealerArAgencyRows,
  normalizeIntelliDealerCompanyRows,
  normalizeIntelliDealerContactRows,
  normalizeIntelliDealerMemoRows,
  normalizeIntelliDealerProfitabilityRows,
} from "./account-360-api";

describe("IntelliDealer account summary normalizers", () => {
  it("normalizes imported company snapshots", () => {
    expect(normalizeIntelliDealerCompanyRows([
      {
        id: "company-1",
        legacy_customer_number: "C100",
        status: "active",
        product_category: "business",
        ar_type: "bad",
        payment_terms_code: "NET30",
        terms_code: null,
        county: "Jefferson",
        territory_code: "T1",
        pricing_level: Number.NaN,
        business_fax: null,
        business_cell: "555-0101",
        do_not_contact: false,
        opt_out_sale_pi: true,
        metadata: { source_system: "intellidealer" },
      },
      { id: null },
    ])).toEqual([
      {
        id: "company-1",
        legacy_customer_number: "C100",
        status: "active",
        product_category: "business",
        ar_type: "open_item",
        payment_terms_code: "NET30",
        terms_code: null,
        county: "Jefferson",
        territory_code: "T1",
        pricing_level: null,
        business_fax: null,
        business_cell: "555-0101",
        do_not_contact: false,
        opt_out_sale_pi: true,
        metadata: { source_system: "intellidealer" },
      },
    ]);
  });

  it("normalizes contacts, A/R agencies, profitability, and memos", () => {
    expect(normalizeIntelliDealerContactRows([
      {
        id: "contact-1",
        first_name: "Ava",
        last_name: "",
        title: "Owner",
        email: 42,
        phone: "555-0102",
        cell: null,
        direct_phone: "555-0103",
      },
    ])[0]).toMatchObject({
      id: "contact-1",
      first_name: "Ava",
      last_name: "",
      email: null,
      phone: "555-0102",
    });

    expect(normalizeIntelliDealerArAgencyRows([
      {
        id: "agency-1",
        agency_code: "",
        expiration_year_month: "202612",
        active: true,
        is_default_agency: null,
        credit_rating: "A",
        default_promotion_code: null,
        credit_limit_cents: 500000,
        transaction_limit_cents: Number.NaN,
      },
    ])[0]).toMatchObject({
      id: "agency-1",
      agency_code: "UNKNOWN",
      active: true,
      is_default_agency: false,
      transaction_limit_cents: null,
    });

    expect(normalizeIntelliDealerProfitabilityRows([
      {
        id: "profit-1",
        area_code: "",
        area_label: "",
        ytd_sales_last_month_end_cents: 100000,
        ytd_costs_last_month_end_cents: 80000,
        current_month_sales_cents: Number.NaN,
        current_month_costs_cents: null,
        ytd_margin_cents: 20000,
        ytd_margin_pct: 20,
        current_month_margin_cents: null,
        current_month_margin_pct: null,
        last_12_margin_cents: null,
        last_12_margin_pct: null,
        fiscal_last_year_sales_cents: null,
        fiscal_last_year_margin_cents: null,
        territory_code: "T1",
        salesperson_code: "SP1",
        county_code: null,
        business_class_code: "BC",
        as_of_date: "2026-04-30",
      },
    ])[0]).toMatchObject({
      id: "profit-1",
      area_code: "unknown",
      area_label: "Unknown",
      current_month_sales_cents: null,
      ytd_margin_pct: 20,
    });

    expect(normalizeIntelliDealerMemoRows([
      {
        id: "memo-1",
        body: "",
        pinned: null,
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      },
    ])[0]).toMatchObject({
      id: "memo-1",
      body: "",
      pinned: false,
    });
  });

  it("returns empty lists for non-array payloads", () => {
    expect(normalizeIntelliDealerCompanyRows(null)).toEqual([]);
    expect(normalizeIntelliDealerContactRows({ id: "contact-1" })).toEqual([]);
    expect(normalizeIntelliDealerArAgencyRows(undefined)).toEqual([]);
    expect(normalizeIntelliDealerProfitabilityRows("bad")).toEqual([]);
    expect(normalizeIntelliDealerMemoRows(42)).toEqual([]);
  });
});
