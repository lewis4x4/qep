import { assertEquals } from "jsr:@std/assert@1";
import { mapCustomerProfileDto, type CustomerProfileRow } from "./customer-profile-dto.ts";

const baseRow: CustomerProfileRow = {
  id: "profile-1",
  hubspot_contact_id: null,
  intellidealer_customer_id: null,
  crm_company_id: "company-1",
  customer_name: "Evergreen Farms",
  company_name: "Evergreen Farms LLC",
  pricing_persona: "value_driven",
  persona_confidence: 0.8,
  persona_model_version: "test",
  lifetime_value: 100000,
  total_deals: 5,
  avg_deal_size: 20000,
  avg_discount_pct: 0.03,
  avg_days_to_close: 21,
  attachment_rate: 0.5,
  service_contract_rate: 0.25,
  fleet_size: 7,
  seasonal_pattern: null,
  last_interaction_at: null,
  price_sensitivity_score: 0.4,
  metadata: { data_badges: ["LIVE"] },
  updated_at: "2026-04-26T00:00:00.000Z",
};

Deno.test("mapCustomerProfileDto masks EIN for reps", () => {
  const dto = mapCustomerProfileDto({
    row: baseRow,
    role: "rep",
    isServiceRole: false,
    includeFleet: false,
    fleet: [],
    customerEin: "12-3456789",
  });

  assertEquals(dto.tax_regulatory, {
    ein: "••-•••6789",
    ein_masked: true,
  });
});

Deno.test("mapCustomerProfileDto exposes full EIN for elevated roles", () => {
  const dto = mapCustomerProfileDto({
    row: baseRow,
    role: "admin",
    isServiceRole: false,
    includeFleet: false,
    fleet: [],
    customerEin: "12-3456789",
  });

  assertEquals(dto.tax_regulatory, {
    ein: "12-3456789",
    ein_masked: false,
  });
});
