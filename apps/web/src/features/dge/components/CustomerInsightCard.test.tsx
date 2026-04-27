import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { CustomerInsightCard } from "./CustomerInsightCard";
import type { CustomerProfileResponse } from "../types";

function makeProfile(overrides: Partial<CustomerProfileResponse> = {}): CustomerProfileResponse {
  return {
    id: "profile-1",
    hubspot_contact_id: null,
    intellidealer_customer_id: null,
    crm_company_id: "company-1",
    customer_name: "Evergreen Farms",
    company_name: "Evergreen Farms LLC",
    pricing_persona: "value_driven",
    persona_confidence: 0.82,
    persona_reasoning: null,
    persona_model_version: "test",
    total_lifetime_value: 120000,
    total_deals: 4,
    avg_deal_size: 30000,
    avg_days_to_close: 22,
    price_sensitivity_score: 0.4,
    fleet_size: 8,
    last_interaction_at: null,
    updated_at: "2026-04-26T00:00:00.000Z",
    data_badges: ["LIVE"],
    ...overrides,
  };
}

describe("CustomerInsightCard Tax / Regulatory block", () => {
  test("renders masked EIN with unauthorized-role disclosure", () => {
    render(
      <CustomerInsightCard
        data={makeProfile({ tax_regulatory: { ein: "••-•••6789", ein_masked: true } })}
        loading={false}
        error={null}
        onRefresh={mock(async () => undefined)}
      />,
    );

    expect(screen.getByText("Tax / Regulatory")).toBeTruthy();
    expect(screen.getByText("••-•••6789")).toBeTruthy();
    expect(screen.getByText("Masked for unauthorized roles.")).toBeTruthy();
  });

  test("renders full EIN without masking disclosure for authorized roles", () => {
    render(
      <CustomerInsightCard
        data={makeProfile({ tax_regulatory: { ein: "12-3456789", ein_masked: false } })}
        loading={false}
        error={null}
        onRefresh={mock(async () => undefined)}
      />,
    );

    expect(screen.getByText("12-3456789")).toBeTruthy();
    expect(screen.queryByText("Masked for unauthorized roles.")).toBeNull();
  });
});
