import { describe, expect, test } from "bun:test";

import {
  buildQuotePdfBranch,
  normalizePendingScenarioSelection,
  parsePendingScenarioSelection,
} from "../quote-builder-page-normalizers";
import type { Branch } from "@/hooks/useBranches";

const validScenario = {
  label: "Low cash option",
  description: "Keeps cash outlay down.",
  programIds: ["program-1", "", 42],
  customerOutOfPocketCents: "2500000",
  monthlyPaymentCents: "125000",
  termMonths: "48",
  totalPaidByCustomerCents: 6000000,
  dealerMarginCents: 800000,
  dealerMarginPct: "12.5",
  commissionCents: 120000,
  pros: ["Low cash", ""],
  cons: ["Higher total paid"],
};

function branchFixture(partial: Partial<Branch> = {}): Branch {
  return {
    id: "branch-1",
    workspace_id: "workspace-1",
    slug: "raleigh",
    display_name: "Raleigh",
    short_code: "RAL",
    is_active: true,
    address_line1: "123 Main St",
    address_line2: null,
    city: "Raleigh",
    state_province: "NC",
    postal_code: "27601",
    country: "US",
    latitude: null,
    longitude: null,
    phone_main: "919-555-0100",
    phone_parts: null,
    phone_service: null,
    phone_sales: null,
    fax: null,
    email_main: "sales@example.com",
    email_parts: null,
    email_service: null,
    email_sales: null,
    website_url: "https://example.com",
    general_manager_id: null,
    sales_manager_id: null,
    service_manager_id: null,
    parts_manager_id: null,
    business_hours: [],
    logo_url: null,
    header_tagline: null,
    doc_footer_text: "Valid 30 days.",
    tax_id: null,
    default_tax_rate: 0,
    license_numbers: [],
    capabilities: [],
    max_service_bays: null,
    rental_yard_capacity: null,
    parts_counter: true,
    delivery_radius_miles: null,
    timezone: "America/New_York",
    notes: null,
    metadata: {},
    created_at: "2026-05-03T12:00:00Z",
    updated_at: "2026-05-03T12:00:00Z",
    deleted_at: null,
    ...partial,
  };
}

describe("quote builder page normalizers", () => {
  test("normalizes pending scenario selections from persisted voice handoffs", () => {
    const selection = normalizePendingScenarioSelection({
      scenario: validScenario,
      resolvedModelId: "model-1",
      resolvedBrandId: null,
      deliveryState: "NC",
      customerType: "gmu",
      prompt: "Need low cash down",
      originatingLogId: "log-1",
      at: "2026-05-03T12:00:00Z",
    }, new Date("2026-05-03T12:05:00Z").getTime());

    expect(selection?.scenario.customerOutOfPocketCents).toBe(2500000);
    expect(selection?.scenario.programIds).toEqual(["program-1"]);
    expect(selection?.scenario.pros).toEqual(["Low cash"]);
    expect(selection?.customerType).toBe("gmu");
    expect(selection?.resolvedModelId).toBe("model-1");
  });

  test("rejects malformed or stale pending scenario selections", () => {
    expect(normalizePendingScenarioSelection({ scenario: { label: "Missing economics" } })).toBeNull();
    expect(normalizePendingScenarioSelection({
      scenario: validScenario,
      customerType: "standard",
      at: "2026-05-03T11:00:00Z",
    }, new Date("2026-05-03T12:00:01Z").getTime())).toBeNull();
    expect(parsePendingScenarioSelection("{not-json")).toBeNull();
  });

  test("builds PDF branch metadata without trusting arbitrary records", () => {
    expect(buildQuotePdfBranch(branchFixture())).toEqual({
      name: "Raleigh",
      address: "123 Main St",
      city: "Raleigh",
      state: "NC",
      postalCode: "27601",
      phone: "919-555-0100",
      email: "sales@example.com",
      website: "https://example.com",
      footerText: "Valid 30 days.",
    });
  });

  test("defaults sparse PDF branch metadata", () => {
    expect(buildQuotePdfBranch(branchFixture({
      display_name: "",
      address_line1: null,
      city: "",
      phone_main: null,
      email_main: "",
      website_url: null,
      doc_footer_text: "",
    }))).toEqual({
      name: "Quality Equipment & Parts",
      address: undefined,
      city: undefined,
      state: "NC",
      postalCode: "27601",
      phone: undefined,
      email: undefined,
      website: undefined,
      footerText: undefined,
    });
  });
});
