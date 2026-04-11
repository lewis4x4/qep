import { describe, expect, it } from "bun:test";
import { buildReplacementPredictionBoard } from "./replacement-prediction";

describe("buildReplacementPredictionBoard", () => {
  it("buckets replacement predictions into 30/60/90/180 day windows", () => {
    const board = buildReplacementPredictionBoard([
      {
        fleetIntelligenceId: "fi-1",
        equipmentId: "eq-1",
        companyId: "company-1",
        customerName: "Oak Ridge Construction",
        make: "CAT",
        model: "320",
        year: 2019,
        equipmentSerial: "CAT320-01",
        currentHours: 4200,
        predictedReplacementDate: "2026-05-01",
        replacementConfidence: 0.82,
        outreachDealValue: 190000,
      },
      {
        fleetIntelligenceId: "fi-2",
        equipmentId: "eq-2",
        companyId: "company-2",
        customerName: "River Dirt",
        make: "Bobcat",
        model: "T66",
        year: 2022,
        equipmentSerial: "T66-9",
        currentHours: 1800,
        predictedReplacementDate: "2026-06-20",
        replacementConfidence: 0.63,
        outreachDealValue: null,
      },
      {
        fleetIntelligenceId: "fi-3",
        equipmentId: "eq-3",
        companyId: "company-3",
        customerName: "Delta Paving",
        make: "Deere",
        model: "310",
        year: 2018,
        equipmentSerial: "310-1",
        currentHours: 5100,
        predictedReplacementDate: "2026-08-15",
        replacementConfidence: 0.45,
        outreachDealValue: 120000,
      },
    ], Date.parse("2026-04-11T00:00:00.000Z"));

    expect(board.summary.due30d).toBe(1);
    expect(board.summary.due60d).toBe(0);
    expect(board.summary.due90d).toBe(1);
    expect(board.summary.due180d).toBe(1);
    expect(board.items[0]?.confidenceBand).toBe("high");
    expect(board.items[1]?.confidenceBand).toBe("medium");
    expect(board.items[2]?.confidenceBand).toBe("low");
  });

  it("drops items outside the 180-day window", () => {
    const board = buildReplacementPredictionBoard([
      {
        fleetIntelligenceId: "fi-1",
        equipmentId: null,
        companyId: null,
        customerName: "Oak Ridge Construction",
        make: "CAT",
        model: "320",
        year: 2019,
        equipmentSerial: null,
        currentHours: 4200,
        predictedReplacementDate: "2027-01-01",
        replacementConfidence: 0.82,
        outreachDealValue: null,
      },
    ], Date.parse("2026-04-11T00:00:00.000Z"));

    expect(board.items).toHaveLength(0);
  });
});
