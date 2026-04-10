import { describe, expect, it } from "bun:test";
import { buildCustomerOperatingProfileBoard, type CustomerOperatingAssessment } from "./customer-operating-profile";
import type { CustomerProfileResponse } from "@/features/dge/types";

const profile: CustomerProfileResponse = {
  id: "profile-1",
  hubspot_contact_id: "hs-1",
  intellidealer_customer_id: null,
  customer_name: "Oak Ridge Construction",
  company_name: "Oak Ridge Construction",
  industry: "Construction",
  region: "Midwest",
  pricing_persona: "relationship_loyal",
  persona_confidence: 0.84,
  persona_reasoning: "Repeat buyer with stable service behavior.",
  persona_model_version: "v2",
  total_lifetime_value: 320000,
  total_deals: 4,
  avg_deal_size: 80000,
  avg_days_to_close: 42,
  price_sensitivity_score: 0.28,
  fleet_size: 7,
  budget_cycle_month: 9,
  budget_cycle_notes: "Approvals usually land before fall work starts.",
  fiscal_year_end_month: 12,
  notes: null,
  last_interaction_at: "2026-04-05T12:00:00.000Z",
  updated_at: "2026-04-10T12:00:00.000Z",
  data_badges: ["LIVE"],
  behavioral_signals: {
    avg_discount_pct: 4,
    attachment_rate: 0.6,
    service_contract_rate: 0.5,
    seasonal_pattern: "spring_push",
  },
  fleet: [],
};

const assessments: CustomerOperatingAssessment[] = [
  {
    id: "na-1",
    dealId: "deal-1",
    dealName: "Compact Track Loader",
    createdAt: "2026-04-08T12:00:00.000Z",
    application: "Land clearing",
    workType: "Site prep",
    terrainMaterial: "Rocky clay",
    brandPreference: "CAT",
    budgetType: "financing",
    monthlyPaymentTarget: 2200,
    financingPreference: "deferred payments",
    nextStep: "demo",
    completenessPct: 82,
    qrmNarrative: "Need machine before summer crew ramp.",
  },
  {
    id: "na-2",
    dealId: "deal-2",
    dealName: "Mini Excavator",
    createdAt: "2026-03-15T12:00:00.000Z",
    application: "Land clearing",
    workType: "Site prep",
    terrainMaterial: "Rocky clay",
    brandPreference: "CAT",
    budgetType: "financing",
    monthlyPaymentTarget: null,
    financingPreference: "deferred payments",
    nextStep: "quote",
    completenessPct: 76,
    qrmNarrative: null,
  },
  {
    id: "na-3",
    dealId: "deal-3",
    dealName: "Skid Steer",
    createdAt: "2026-02-20T12:00:00.000Z",
    application: "Material handling",
    workType: "Yard maintenance",
    terrainMaterial: "Mixed gravel",
    brandPreference: "Bobcat",
    budgetType: "cash",
    monthlyPaymentTarget: null,
    financingPreference: null,
    nextStep: "follow_up",
    completenessPct: 68,
    qrmNarrative: null,
  },
];

describe("buildCustomerOperatingProfileBoard", () => {
  it("derives dominant operating traits from assessments and DNA signals", () => {
    const board = buildCustomerOperatingProfileBoard(profile, assessments);

    expect(board.summary.assessments).toBe(3);
    expect(board.summary.monthlyTargetAssessments).toBe(1);
    expect(board.workType.primary).toBe("Site Prep");
    expect(board.terrain.primary).toBe("Rocky Clay");
    expect(board.brandPreference.primary).toBe("CAT");
    expect(board.budgetBehavior.primary).toBe("September budget-cycle motion");
    expect(board.buyingStyle.primary).toBe("Relationship-led buying style");
    expect(board.buyingStyle.supporting.join(" ")).toContain("Attachment rate 60%");
    expect(board.budgetBehavior.supporting.join(" ")).toContain("Preferred financing: Deferred Payments.");
  });

  it("falls back gracefully when assessment evidence is sparse", () => {
    const board = buildCustomerOperatingProfileBoard(null, []);

    expect(board.workType.primary).toBe("Work profile still forming");
    expect(board.terrain.primary).toBe("Terrain profile still forming");
    expect(board.brandPreference.primary).toBe("Brand preference still forming");
    expect(board.budgetBehavior.primary).toBe("Budget behavior still forming");
    expect(board.buyingStyle.primary).toBe("Buying style still forming");
  });
});
