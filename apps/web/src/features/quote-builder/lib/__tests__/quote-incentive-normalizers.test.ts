import { describe, expect, test } from "bun:test";
import { normalizeAppliedIncentives } from "../quote-incentive-normalizers";

describe("quote incentive normalizers", () => {
  test("normalizes applied incentives and joined manufacturer rows", () => {
    expect(normalizeAppliedIncentives([
      {
        id: "app-1",
        incentive_id: "inc-1",
        applied_amount: "2500",
        auto_applied: true,
        removed_at: null,
        manufacturer_incentives: {
          program_name: "Skid steer cash back",
          manufacturer: "John Deere",
          discount_type: "cash_back",
          requires_approval: false,
          stackable: true,
        },
      },
      {
        id: "app-2",
        incentive_id: "inc-2",
        applied_amount: 1.9,
        auto_applied: false,
        removed_at: "2026-05-03T12:00:00.000Z",
        manufacturer_incentives: [{
          program_name: "APR buy-down",
          manufacturer: null,
          discount_type: "apr_buydown",
          requires_approval: true,
          stackable: false,
        }],
      },
      { id: "bad", incentive_id: "inc-bad", applied_amount: "NaN" },
    ])).toEqual([
      {
        id: "app-1",
        incentive_id: "inc-1",
        applied_amount: 2500,
        auto_applied: true,
        removed_at: null,
        manufacturer_incentives: {
          program_name: "Skid steer cash back",
          manufacturer: "John Deere",
          discount_type: "cash_back",
          requires_approval: false,
          stackable: true,
        },
      },
      {
        id: "app-2",
        incentive_id: "inc-2",
        applied_amount: 1.9,
        auto_applied: false,
        removed_at: "2026-05-03T12:00:00.000Z",
        manufacturer_incentives: {
          program_name: "APR buy-down",
          manufacturer: "Unknown manufacturer",
          discount_type: "apr_buydown",
          requires_approval: true,
          stackable: false,
        },
      },
    ]);
  });

  test("returns empty arrays for malformed inputs", () => {
    expect(normalizeAppliedIncentives(null)).toEqual([]);
    expect(normalizeAppliedIncentives({ id: "app-1" })).toEqual([]);
    expect(normalizeAppliedIncentives([{ id: "app-1", applied_amount: 100 }])).toEqual([]);
  });
});
