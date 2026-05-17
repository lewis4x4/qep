import { describe, expect, test } from "bun:test";
import { buildQuoteBuilderHref, buildQuoteListHref } from "../quote-route";

describe("buildQuoteBuilderHref", () => {
  test("falls back to /sales/quotes/new with no params", () => {
    expect(buildQuoteBuilderHref()).toBe("/sales/quotes/new");
    expect(buildQuoteBuilderHref({})).toBe("/sales/quotes/new");
  });

  test("routes by path-param when quoteId is supplied", () => {
    expect(buildQuoteBuilderHref({ quoteId: "qp_abc" })).toBe("/sales/quotes/qp_abc");
  });

  test("emits crm_deal_id query param", () => {
    expect(buildQuoteBuilderHref({ dealId: "deal-1" })).toBe(
      "/sales/quotes/new?crm_deal_id=deal-1",
    );
  });

  test("emits crm_contact_id query param", () => {
    expect(buildQuoteBuilderHref({ contactId: "ct-7" })).toBe(
      "/sales/quotes/new?crm_contact_id=ct-7",
    );
  });

  test("emits crm_company_id query param", () => {
    expect(buildQuoteBuilderHref({ companyId: "co-42" })).toBe(
      "/sales/quotes/new?crm_company_id=co-42",
    );
  });

  test("emits package_id query param", () => {
    expect(buildQuoteBuilderHref({ packageId: "pkg-9" })).toBe(
      "/sales/quotes/new?package_id=pkg-9",
    );
  });

  test("encodes special characters in id values", () => {
    expect(
      buildQuoteBuilderHref({ dealId: "deal/1 with space" }),
    ).toBe("/sales/quotes/new?crm_deal_id=deal%2F1+with+space");
  });

  test("combines quoteId path-param with query params", () => {
    expect(
      buildQuoteBuilderHref({ quoteId: "qp_abc", dealId: "deal-1" }),
    ).toBe("/sales/quotes/qp_abc?crm_deal_id=deal-1");
  });

  test("emits prospect_converted=1 flag when true, drops when false/omitted", () => {
    expect(buildQuoteBuilderHref({ prospectConverted: true })).toBe(
      "/sales/quotes/new?prospect_converted=1",
    );
    expect(buildQuoteBuilderHref({ prospectConverted: false })).toBe("/sales/quotes/new");
    expect(buildQuoteBuilderHref({ prospectConverted: undefined })).toBe(
      "/sales/quotes/new",
    );
  });

  test("emits multiple params in stable order", () => {
    const href = buildQuoteBuilderHref({
      dealId: "deal-1",
      contactId: "ct-7",
      companyId: "co-42",
      packageId: "pkg-9",
      prospectConverted: true,
    });
    // URLSearchParams preserves insertion order: deal, contact, company, package, prospect.
    expect(href).toBe(
      "/sales/quotes/new?crm_deal_id=deal-1&crm_contact_id=ct-7&crm_company_id=co-42&package_id=pkg-9&prospect_converted=1",
    );
  });

  test("ignores empty string ids (don't emit '?crm_deal_id=' for falsy)", () => {
    expect(buildQuoteBuilderHref({ dealId: "" })).toBe("/sales/quotes/new");
    expect(buildQuoteBuilderHref({ quoteId: "" })).toBe("/sales/quotes/new");
  });
});

describe("buildQuoteListHref", () => {
  test("returns the canonical list path", () => {
    expect(buildQuoteListHref()).toBe("/sales/quotes");
  });
});
