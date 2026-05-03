import { describe, expect, test } from "bun:test";
import {
  getDgeEdgeErrorMessage,
  normalizeCustomerProfileResponse,
  normalizeDgeScenarioList,
  normalizeDgeScenarioResponse,
  normalizeMarketValuationResult,
} from "./dge-api-normalizers";

describe("DGE API normalizers", () => {
  test("normalizes market valuation payloads and filters malformed source rows", () => {
    const result = normalizeMarketValuationResult({
      id: "valuation-1",
      estimated_fmv: "125000",
      low_estimate: 110000,
      high_estimate: "135000",
      confidence_score: "0.82",
      source: "market-valuation",
      source_breakdown: [
        { source: "auction", value: "120000", weight: "0.5", confidence: 0.8 },
        { source: "", value: 1, weight: 1, confidence: 1 },
      ],
      data_badges: ["LIVE", "UNKNOWN", "ESTIMATED"],
      expires_at: "2026-05-03T12:00:00Z",
    });

    expect(result).toEqual({
      id: "valuation-1",
      estimated_fmv: 125000,
      low_estimate: 110000,
      high_estimate: 135000,
      confidence_score: 0.82,
      source: "market-valuation",
      source_breakdown: [{ source: "auction", value: 120000, weight: 0.5, confidence: 0.8 }],
      data_badges: ["LIVE", "ESTIMATED"],
      expires_at: "2026-05-03T12:00:00Z",
    });
  });

  test("rejects malformed market valuation payloads", () => {
    expect(() => normalizeMarketValuationResult({ id: "valuation-1", estimated_fmv: "bad" })).toThrow(
      "Malformed market valuation response.",
    );
  });

  test("normalizes customer profile payloads with nested signals and fleet rows", () => {
    const result = normalizeCustomerProfileResponse({
      id: "profile-1",
      hubspot_contact_id: 123,
      intellidealer_customer_id: "C001",
      customer_name: "TigerCat Logistics",
      company_name: "TigerCat",
      pricing_persona: "value",
      persona_confidence: "0.7",
      total_lifetime_value: "1000000",
      total_deals: "12",
      avg_deal_size: "83333",
      avg_days_to_close: "42",
      price_sensitivity_score: "0.4",
      fleet_size: "3",
      last_interaction_at: "bad-date",
      updated_at: "2026-05-03T12:00:00Z",
      data_badges: ["LIVE", "AI_OFFLINE", "bad"],
      behavioral_signals: {
        avg_discount_pct: "4.5",
        attachment_rate: "0.35",
        service_contract_rate: null,
        seasonal_pattern: "spring",
      },
      fleet: [
        { id: "fleet-1", make: "Deere", model: "333G", year: "2022", current_hours: "510.5" },
        { id: "fleet-2", make: "", model: "Invalid" },
      ],
    });

    expect(result).toMatchObject({
      id: "profile-1",
      hubspot_contact_id: null,
      intellidealer_customer_id: "C001",
      customer_name: "TigerCat Logistics",
      persona_confidence: 0.7,
      total_lifetime_value: 1000000,
      total_deals: 12,
      avg_deal_size: 83333,
      avg_days_to_close: 42,
      price_sensitivity_score: 0.4,
      fleet_size: 3,
      last_interaction_at: null,
      updated_at: "2026-05-03T12:00:00Z",
      data_badges: ["LIVE", "AI_OFFLINE"],
      behavioral_signals: {
        avg_discount_pct: 4.5,
        attachment_rate: 0.35,
        service_contract_rate: null,
        seasonal_pattern: "spring",
      },
      fleet: [{ id: "fleet-1", equipment_serial: null, make: "Deere", model: "333G", year: 2022, current_hours: 510.5 }],
    });
  });

  test("normalizes DGE scenario responses and variable breakdowns", () => {
    const result = normalizeDgeScenarioResponse({
      selected_scenario: "balanced",
      scenarios: [
        {
          id: "scenario-1",
          scenario_type: "max_margin",
          type: "",
          label: "",
          equipment_price: "125000",
          margin_pct: "18.5",
          dge_variable_breakdown: [
            {
              id: "var-1",
              variable_name: "Discount",
              variable_value: "3.2",
              variable_unit: "pct",
              weight: "0.4",
              impact_direction: "positive",
              display_order: "2",
            },
            { id: "", variable_name: "Invalid" },
          ],
        },
        { id: null, scenario_type: "balanced" },
      ],
    });

    expect(result).toEqual({
      selected_scenario: "balanced",
      scenarios: [{
        id: "scenario-1",
        scenario_type: "max_margin",
        type: "max_margin",
        label: "max_margin",
        equipment_price: 125000,
        trade_allowance: undefined,
        total_deal_value: undefined,
        total_margin: undefined,
        margin_pct: 18.5,
        close_probability: undefined,
        expected_value: undefined,
        reasoning: undefined,
        dge_variable_breakdown: [{
          id: "var-1",
          variable_name: "Discount",
          variable_value: 3.2,
          variable_unit: "pct",
          weight: 0.4,
          impact_direction: "positive",
          description: "",
          display_order: 2,
        }],
      }],
    });
  });

  test("normalizes legacy scenario lists that do not include persisted IDs", () => {
    const result = normalizeDgeScenarioList({
      scenarios: [
        { type: "balanced", label: "Balanced", close_probability: "62.5", expected_value: "75000" },
        { type: "", label: "Invalid" },
      ],
    });

    expect(result).toEqual([{
      id: undefined,
      scenario_type: undefined,
      type: "balanced",
      label: "Balanced",
      equipment_price: undefined,
      trade_allowance: undefined,
      total_deal_value: undefined,
      total_margin: undefined,
      margin_pct: undefined,
      close_probability: 62.5,
      expected_value: 75000,
      reasoning: undefined,
      dge_variable_breakdown: [],
    }]);
  });

  test("extracts edge error messages safely", () => {
    expect(getDgeEdgeErrorMessage({ error: { message: "Denied" } }, "Fallback")).toBe("Denied");
    expect(getDgeEdgeErrorMessage({ error: { message: "" } }, "Fallback")).toBe("Fallback");
    expect(getDgeEdgeErrorMessage({}, "Fallback")).toBe("Fallback");
  });
});
