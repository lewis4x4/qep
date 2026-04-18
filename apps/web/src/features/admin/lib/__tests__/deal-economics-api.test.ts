import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockUpsert = mock(() => Promise.resolve({ error: null }));
const mockFrom   = mock(() => ({ upsert: mockUpsert }));

mock.module("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

const { upsertServiceCredits, dollarsToCents } = await import("../deal-economics-api");

describe("deal-economics-api", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockUpsert.mockClear();
  });

  test("upsertServiceCredits sends exactly 3 rows in a single .upsert() call", async () => {
    const rows = [
      { workspace_id: "default", category: "compact",  credit_cents: 150000, travel_budget_cents: 20000 },
      { workspace_id: "default", category: "large",    credit_cents: 250000, travel_budget_cents: 20000 },
      { workspace_id: "default", category: "forestry", credit_cents: 350000, travel_budget_cents: 20000 },
    ];

    const result = await upsertServiceCredits(rows);

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("qb_service_credit_config");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(rows);
    expect(result).toEqual({ ok: true });
  });

  test("dollar to cents conversion is correct", () => {
    expect(dollarsToCents(150.00)).toBe(15000);
    expect(dollarsToCents(1500.00)).toBe(150000);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(25.99)).toBe(2599);
  });

  test("upsertServiceCredits returns { error } on DB failure — does not throw", async () => {
    mockUpsert.mockImplementationOnce(() =>
      Promise.resolve({ error: { message: "constraint violation" } })
    );

    const rows = [
      { workspace_id: "default", category: "compact",  credit_cents: 150000, travel_budget_cents: 20000 },
      { workspace_id: "default", category: "large",    credit_cents: 250000, travel_budget_cents: 20000 },
      { workspace_id: "default", category: "forestry", credit_cents: 350000, travel_budget_cents: 20000 },
    ];

    const result = await upsertServiceCredits(rows);
    expect(result).toEqual({ error: "constraint violation" });
  });
});
