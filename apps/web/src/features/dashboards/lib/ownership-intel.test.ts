import { describe, expect, test } from "bun:test";
import {
  buildForecastBuckets,
  buildIncentiveEligibleDeals,
  computePredictionLedgerAccuracy,
  summarizeIncentiveExposure,
} from "./ownership-intel";

describe("buildForecastBuckets", () => {
  test("groups deals into 30/60/90-day buckets using expected close date", () => {
    const buckets = buildForecastBuckets(
      [
        { id: "deal-1", amount: 100_000, weighted_amount: 60_000, expected_close_on: "2026-04-15" },
        { id: "deal-2", amount: 80_000, weighted_amount: 32_000, expected_close_on: "2026-05-20" },
        { id: "deal-3", amount: 50_000, weighted_amount: 20_000, expected_close_on: "2026-06-25" },
        { id: "deal-4", amount: 40_000, weighted_amount: 10_000, expected_close_on: "2026-08-01" },
      ],
      new Date("2026-04-09T09:00:00-04:00"),
    );

    expect(buckets).toEqual([
      { key: "30d", label: "30 days", horizonDays: 30, dealCount: 1, rawPipeline: 100_000, weightedRevenue: 60_000 },
      { key: "60d", label: "60 days", horizonDays: 60, dealCount: 1, rawPipeline: 80_000, weightedRevenue: 32_000 },
      { key: "90d", label: "90 days", horizonDays: 90, dealCount: 1, rawPipeline: 50_000, weightedRevenue: 20_000 },
    ]);
  });

  test("treats overdue expected close dates as 30-day forecast pressure", () => {
    const buckets = buildForecastBuckets(
      [
        { id: "deal-1", amount: 25_000, weighted_amount: 15_000, expected_close_on: "2026-04-01" },
      ],
      new Date("2026-04-09T09:00:00-04:00"),
    );

    expect(buckets[0].dealCount).toBe(1);
    expect(buckets[0].weightedRevenue).toBe(15_000);
  });
});

describe("incentive exposure helpers", () => {
  test("dedupes deal exposure when multiple expiring incentives share a manufacturer", () => {
    const eligibleDeals = buildIncentiveEligibleDeals(
      [
        { id: "deal-1", amount: 110_000, weighted_amount: 66_000, expected_close_on: "2026-04-20" },
        { id: "deal-2", amount: 90_000, weighted_amount: 45_000, expected_close_on: "2026-04-30" },
      ],
      [
        { deal_id: "deal-1", role: "subject", crm_equipment: { make: "Yanmar", category: "excavator" } },
        { deal_id: "deal-2", role: "subject", crm_equipment: { make: "Bandit", category: "other" } },
      ],
    );

    const exposure = summarizeIncentiveExposure(
      [
        { id: "inc-1", manufacturer: "Yanmar", program_name: "Spring Cash", expiration_date: "2026-04-10" },
        { id: "inc-2", manufacturer: "Yanmar", program_name: "APR Buydown", expiration_date: "2026-04-10" },
      ],
      eligibleDeals,
    );

    expect(exposure.expiringIncentiveCount).toBe(2);
    expect(exposure.affectedDealCount).toBe(1);
    expect(exposure.totalExposure).toBe(110_000);
    expect(exposure.affectedManufacturers).toEqual(["yanmar"]);
  });
});

describe("computePredictionLedgerAccuracy", () => {
  test("uses only won/lost outcomes for the accuracy proxy", () => {
    const accuracy = computePredictionLedgerAccuracy([
      { outcome: "won" },
      { outcome: "lost" },
      { outcome: "expired" },
      { outcome: "snoozed" },
      { outcome: null },
    ]);

    expect(accuracy.resolvedCount).toBe(2);
    expect(accuracy.wonCount).toBe(1);
    expect(accuracy.accuracyPct).toBe(50);
  });
});
