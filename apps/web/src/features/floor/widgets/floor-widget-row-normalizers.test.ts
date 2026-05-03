import { describe, expect, test } from "bun:test";
import {
  normalizeCompanyHits,
  normalizeCustomerHealthProfiles,
  normalizeEquipmentHits,
} from "./floor-widget-row-normalizers";

describe("floor widget row normalizers", () => {
  test("normalizes customer search hits", () => {
    expect(normalizeCompanyHits([
      {
        id: "company-1",
        name: "Tigercat Logistics",
        dba: "Tiger",
        legacy_customer_number: "TIGER001",
        phone: "555-0100",
        city: "Louisville",
        state: "KY",
      },
      { id: "", name: "Bad" },
      { name: "Missing id" },
    ])).toEqual([
      {
        id: "company-1",
        name: "Tigercat Logistics",
        dba: "Tiger",
        legacy_customer_number: "TIGER001",
        phone: "555-0100",
        city: "Louisville",
        state: "KY",
      },
    ]);
  });

  test("normalizes serial lookup equipment hits and joined company arrays", () => {
    expect(normalizeEquipmentHits([
      {
        id: "equipment-1",
        serial_number: "SN-100",
        name: "Loader",
        make: "Deere",
        model: "333G",
        year: "2024",
        condition: "good",
        engine_hours: "120.5",
        last_inspection_at: "2026-04-01T00:00:00.000Z",
        next_service_due_at: "2026-06-01T00:00:00.000Z",
        location_description: "Yard",
        company: [{ id: "company-1", name: "Tigercat Logistics", dba: null, phone: "555-0100" }],
      },
      { id: "", serial_number: "BAD" },
    ])).toEqual([
      {
        id: "equipment-1",
        serial_number: "SN-100",
        name: "Loader",
        make: "Deere",
        model: "333G",
        year: 2024,
        condition: "good",
        engine_hours: 120.5,
        last_inspection_at: "2026-04-01T00:00:00.000Z",
        next_service_due_at: "2026-06-01T00:00:00.000Z",
        location_description: "Yard",
        company: { id: "company-1", name: "Tigercat Logistics", dba: null, phone: "555-0100" },
      },
    ]);
  });

  test("normalizes customer health rows and component payloads", () => {
    expect(normalizeCustomerHealthProfiles([
      {
        id: "company-1",
        customer_name: "Tiger Buyer",
        company_name: "Tigercat Logistics",
        health_score: "42",
        health_score_components: {
          deal_velocity: 10,
          service_engagement: 11,
          parts_revenue: 12,
          financial_health: "not numeric",
        },
        health_score_updated_at: "2026-05-01T00:00:00.000Z",
        pricing_persona: "strategic",
        lifetime_value: "150000",
      },
      { id: "", health_score: 10 },
    ])).toEqual([
      {
        id: "company-1",
        customer_name: "Tiger Buyer",
        company_name: "Tigercat Logistics",
        health_score: 42,
        health_score_components: {
          deal_velocity: 10,
          service_engagement: 11,
          parts_revenue: 12,
          financial_health: 0,
        },
        health_score_updated_at: "2026-05-01T00:00:00.000Z",
        pricing_persona: "strategic",
        lifetime_value: 150000,
      },
    ]);
  });

  test("returns empty arrays for non-array inputs", () => {
    expect(normalizeCompanyHits(null)).toEqual([]);
    expect(normalizeEquipmentHits({ id: "equipment-1" })).toEqual([]);
    expect(normalizeCustomerHealthProfiles(undefined)).toEqual([]);
  });
});
