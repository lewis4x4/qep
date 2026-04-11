import { describe, expect, it } from "bun:test";
import { buildWhiteSpaceMapBoard } from "./white-space-map";
import type { Account360FleetItem, Account360PartsRollup, Account360ServiceJob } from "./account-360-api";
import type { CustomerFleetUnit, CustomerProfileResponse } from "@/features/dge/types";

const fleet: Account360FleetItem[] = [
  {
    id: "eq-1",
    name: "CAT 320",
    make: "CAT",
    model: "320",
    year: 2019,
    engine_hours: 4200,
    serial_number: "CAT320-01",
    asset_tag: null,
    stage_label: null,
    eta: null,
    stage_updated: null,
  },
  {
    id: "eq-2",
    name: "Bobcat T66",
    make: "Bobcat",
    model: "T66",
    year: 2023,
    engine_hours: 900,
    serial_number: "T66-9",
    asset_tag: null,
    stage_label: null,
    eta: null,
    stage_updated: null,
  },
];

const service: Account360ServiceJob[] = [
  {
    id: "job-1",
    current_stage: "in_progress",
    customer_problem_summary: "Hydraulic leak",
    scheduled_start_at: null,
    scheduled_end_at: null,
    completed_at: null,
    machine_id: "eq-1",
  },
];

const parts: Account360PartsRollup = {
  lifetime_total: 1800,
  order_count: 0,
  recent: [],
};

const profile: CustomerProfileResponse = {
  id: "profile-1",
  hubspot_contact_id: null,
  intellidealer_customer_id: null,
  customer_name: "Oak Ridge Construction",
  company_name: "Oak Ridge Construction",
  industry: "Construction",
  region: "Midwest",
  pricing_persona: "value_driven",
  persona_confidence: 0.7,
  persona_reasoning: null,
  persona_model_version: "v2",
  total_lifetime_value: 300000,
  total_deals: 3,
  avg_deal_size: 100000,
  avg_days_to_close: 35,
  price_sensitivity_score: 0.65,
  fleet_size: 2,
  budget_cycle_month: null,
  budget_cycle_notes: null,
  fiscal_year_end_month: null,
  notes: null,
  last_interaction_at: null,
  updated_at: "2026-04-11T00:00:00.000Z",
  data_badges: ["LIVE"],
  behavioral_signals: {
    avg_discount_pct: 5,
    attachment_rate: 0.2,
    service_contract_rate: 0.25,
    seasonal_pattern: "steady",
  },
  fleet: [],
};

const predictions: CustomerFleetUnit[] = [
  {
    id: "fi-1",
    equipment_serial: "CAT320-01",
    make: "CAT",
    model: "320",
    year: 2019,
    current_hours: 4200,
    predicted_replacement_date: "2026-05-15",
    replacement_confidence: 0.82,
  },
];

describe("buildWhiteSpaceMapBoard", () => {
  it("surfaces replacement, attachment, service, and parts whitespace", () => {
    const board = buildWhiteSpaceMapBoard({
      fleet,
      service,
      parts,
      profile,
      predictions,
      equipmentSignals: [
        { equipmentId: "eq-1", attachmentCount: 1, currentMarketValue: 120000, replacementCost: 180000 },
        { equipmentId: "eq-2", attachmentCount: 0, currentMarketValue: 45000, replacementCost: 62000 },
      ],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.total).toBe(4);
    expect(board.summary.replacement).toBe(1);
    expect(board.summary.attachment).toBe(1);
    expect(board.summary.serviceCoverage).toBe(1);
    expect(board.summary.partsPenetration).toBe(1);
    expect(board.opportunities[0]?.type).toBe("replacement");
    expect(board.opportunities.find((item) => item.type === "replacement")?.estimatedRevenue).toBe(180000);
    expect(board.opportunities.find((item) => item.type === "attachment")?.equipmentId).toBe("eq-2");
  });

  it("stays quiet when the account has no whitespace signals", () => {
    const board = buildWhiteSpaceMapBoard({
      fleet: [fleet[0]!],
      service: [],
      parts: { lifetime_total: 10000, order_count: 4, recent: [] },
      profile: {
        ...profile,
        behavioral_signals: {
          avg_discount_pct: 5,
          attachment_rate: 0.75,
          service_contract_rate: 0.7,
          seasonal_pattern: "steady",
        },
      },
      predictions: [],
      equipmentSignals: [{ equipmentId: "eq-1", attachmentCount: 2, currentMarketValue: 120000, replacementCost: 180000 }],
      nowTime: Date.parse("2026-04-11T00:00:00.000Z"),
    });

    expect(board.summary.total).toBe(0);
    expect(board.opportunities).toHaveLength(0);
  });
});
