import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Supabase mock ────────────────────────────────────────────────────────────
// We build a chainable mock that returns itself for select/order/eq calls,
// and stores the terminal operation (upsert/insert/update/delete) so we can
// assert on it independently.

const mockUpsert  = mock(() => Promise.resolve({ error: null }));
const mockInsert  = mock(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "new-id" }, error: null }) }) }));
const mockUpdate  = mock(() => ({ eq: mock(() => Promise.resolve({ error: null })) }));
const mockDelete  = mock(() => ({ eq: mock(() => Promise.resolve({ error: null })) }));
const mockSelect  = mock(() => ({ order: mockOrder }));
const mockOrder: ReturnType<typeof mock> = mock(() => ({ order: mockOrder2 }));
const mockOrder2  = mock(() => Promise.resolve({ data: [], error: null }));

const mockFrom = mock((_table: string) => ({
  upsert:  mockUpsert,
  insert:  mockInsert,
  update:  mockUpdate,
  delete:  mockDelete,
  select:  mockSelect,
}));

mock.module("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}));

const {
  upsertServiceCredits,
  dollarsToCents,
  getFreightRules,
  createFreightRule,
  updateFreightRule,
  deleteFreightRule,
} = await import("../deal-economics-api");

describe("deal-economics-api", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockUpsert.mockClear();
    mockInsert.mockClear();
    mockUpdate.mockClear();
    mockDelete.mockClear();
    mockSelect.mockClear();
    mockOrder.mockClear();
    mockOrder2.mockClear();
  });

  // ── Service credits ────────────────────────────────────────────────────────

  test("upsertServiceCredits sends exactly 3 rows in a single .upsert() call", async () => {
    const rows = [
      { workspace_id: "default", category: "compact",  credit_cents: 150000, travel_budget_cents: 20000 },
      { workspace_id: "default", category: "large",    credit_cents: 250000, travel_budget_cents: 20000 },
      { workspace_id: "default", category: "forestry", credit_cents: 350000, travel_budget_cents: 20000 },
    ];

    const result = await upsertServiceCredits(rows);

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

  // ── Freight rules ──────────────────────────────────────────────────────────

  test("getFreightRules queries qb_internal_freight_rules ordered by priority then created_at", async () => {
    await getFreightRules();
    expect(mockFrom).toHaveBeenCalledWith("qb_internal_freight_rules");
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockOrder).toHaveBeenCalledWith("priority", { ascending: true });
    expect(mockOrder2).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  test("createFreightRule sends all user-provided fields plus workspace_id default", async () => {
    const input = {
      workspace_id:        "default",
      weight_from_lbs:     1000,
      weight_to_lbs:       5000,
      distance_from_miles: 0,
      distance_to_miles:   100,
      rate_type:           "flat",
      rate_amount_cents:   25000,
      priority:            50,
    };
    const result = await createFreightRule(input);
    expect(mockFrom).toHaveBeenCalledWith("qb_internal_freight_rules");
    expect(mockInsert).toHaveBeenCalledWith(input);
    expect(result).toEqual({ ok: true, id: "new-id" });
  });

  test("deleteFreightRule sends .eq('id', id) with the correct id", async () => {
    const eqMock = mock(() => Promise.resolve({ error: null }));
    mockDelete.mockImplementationOnce(() => ({ eq: eqMock }));

    await deleteFreightRule("rule-abc-123");

    expect(mockFrom).toHaveBeenCalledWith("qb_internal_freight_rules");
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "rule-abc-123");
    // ensure it did NOT use a different id
    expect(eqMock).not.toHaveBeenCalledWith("id", "someotherid");
  });

  test("updateFreightRule sends .update(input).eq('id', id) with the correct id", async () => {
    const eqMock = mock(() => Promise.resolve({ error: null }));
    mockUpdate.mockImplementationOnce(() => ({ eq: eqMock }));

    const input = { rate_type: "per_mile", rate_amount_cents: 500, priority: 10 };
    await updateFreightRule("rule-xyz-999", input as Parameters<typeof updateFreightRule>[1]);

    expect(mockFrom).toHaveBeenCalledWith("qb_internal_freight_rules");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "rule-xyz-999");
  });
});
