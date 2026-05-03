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
  getBrandFreightKeys,
  setBrandFreightKey,
  getBrandEngineStatus,
  setBrandDealEngineEnabled,
  isBrandQuoteReady,
  missingPrereqs,
  normalizeBrandEngineBrandRows,
  normalizeBrandFreightKeyRows,
  normalizeBrandProgramRows,
  normalizeBrandSheetRows,
  normalizeBrandZoneRows,
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

  // ── Brand freight keys ─────────────────────────────────────────────────────

  test("normalizes brand freight key rows and filters malformed brands", () => {
    expect(normalizeBrandFreightKeyRows([
      { id: "b1", code: "ASV", name: "ASV", has_inbound_freight_key: true },
      { id: "b2", code: "BAD", has_inbound_freight_key: true },
    ])).toEqual([
      { id: "b1", code: "ASV", name: "ASV", has_inbound_freight_key: true },
    ]);
  });

  test("getBrandFreightKeys selects from qb_brands ordered by name", async () => {
    await getBrandFreightKeys();
    expect(mockFrom).toHaveBeenCalledWith("qb_brands");
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockOrder).toHaveBeenCalledWith("name", { ascending: true });
  });

  test("setBrandFreightKey sends .update({ has_inbound_freight_key }).eq('id', brandId)", async () => {
    const eqMock = mock(() => Promise.resolve({ error: null }));
    mockUpdate.mockImplementationOnce(() => ({ eq: eqMock }));

    const result = await setBrandFreightKey("brand-uuid", true);

    expect(mockFrom).toHaveBeenCalledWith("qb_brands");
    expect(mockUpdate).toHaveBeenCalledWith({ has_inbound_freight_key: true });
    expect(eqMock).toHaveBeenCalledWith("id", "brand-uuid");
    expect(result).toEqual({ ok: true });
  });

  test("setBrandFreightKey returns { error } on DB failure — does not throw", async () => {
    const eqMock = mock(() => Promise.resolve({ error: { message: "permission denied" } }));
    mockUpdate.mockImplementationOnce(() => ({ eq: eqMock }));

    const result = await setBrandFreightKey("brand-uuid", false);
    expect(result).toEqual({ error: "permission denied" });
  });

  // ── Brand Engine Status (CP9) ────────────────────────────────────────────

  test("normalizes brand engine source rows before rollup counting", () => {
    expect(normalizeBrandEngineBrandRows([
      { id: "b1", code: "ASV", name: "ASV", discount_configured: true, has_inbound_freight_key: false },
      { id: "bad", code: "BAD" },
    ])).toEqual([
      { id: "b1", code: "ASV", name: "ASV", discount_configured: true, has_inbound_freight_key: false },
    ]);

    expect(normalizeBrandSheetRows([
      { brand_id: "b1", status: "published" },
      { brand_id: null, status: "published" },
      { brand_id: "b2", status: "" },
    ])).toEqual([{ brand_id: "b1", status: "published" }]);

    expect(normalizeBrandZoneRows([{ brand_id: "b1" }, { brand_id: "" }])).toEqual([{ brand_id: "b1" }]);
    expect(normalizeBrandProgramRows([{ brand_id: "b1", active: true }, { brand_id: "b2", active: "yes" }]))
      .toEqual([{ brand_id: "b1", active: true }, { brand_id: "b2", active: false }]);
  });

  test("getBrandEngineStatus fires 4 parallel queries to the right tables", async () => {
    await getBrandEngineStatus();
    expect(mockFrom).toHaveBeenCalledWith("qb_brands");
    expect(mockFrom).toHaveBeenCalledWith("qb_price_sheets");
    expect(mockFrom).toHaveBeenCalledWith("qb_freight_zones");
    expect(mockFrom).toHaveBeenCalledWith("qb_programs");
  });

  test("getBrandEngineStatus merges sheet/zone/program counts into per-brand rows", async () => {
    const brandsRow = { order: mock(() => Promise.resolve({
      data: [
        { id: "b1", code: "ASV", name: "ASV", discount_configured: true,  has_inbound_freight_key: true  },
        { id: "b2", code: "BAR", name: "Barko", discount_configured: false, has_inbound_freight_key: false },
      ],
      error: null,
    })) };
    const sheetsRes = Promise.resolve({
      data: [
        { brand_id: "b1", status: "published" },
        { brand_id: "b1", status: "published" },
        { brand_id: "b1", status: "extracted"  }, // not yet published — excluded
        { brand_id: "b2", status: "superseded" }, // excluded
      ],
      error: null,
    });
    const zonesRes = Promise.resolve({
      data: [{ brand_id: "b1" }, { brand_id: "b1" }, { brand_id: "b1" }],
      error: null,
    });
    const programsRes = Promise.resolve({
      data: [
        { brand_id: "b1", active: true  },
        { brand_id: "b1", active: true  },
        { brand_id: "b1", active: false }, // inactive — excluded
      ],
      error: null,
    });

    // First select: qb_brands (needs .order); next 3: direct awaits on .select()
    mockSelect.mockImplementationOnce(() => brandsRow);
    mockSelect.mockImplementationOnce(() => sheetsRes);
    mockSelect.mockImplementationOnce(() => zonesRes);
    mockSelect.mockImplementationOnce(() => programsRes);

    const rows = await getBrandEngineStatus();

    expect(rows).toHaveLength(2);
    const asv = rows.find((r) => r.id === "b1")!;
    expect(asv.name).toBe("ASV");
    expect(asv.discount_configured).toBe(true);
    expect(asv.published_sheet_count).toBe(2);
    expect(asv.freight_zone_count).toBe(3);
    expect(asv.active_program_count).toBe(2);

    const barko = rows.find((r) => r.id === "b2")!;
    expect(barko.discount_configured).toBe(false);
    expect(barko.published_sheet_count).toBe(0);
    expect(barko.freight_zone_count).toBe(0);
    expect(barko.active_program_count).toBe(0);
  });

  test("setBrandDealEngineEnabled writes { discount_configured } to qb_brands WHERE id = brandId", async () => {
    const eqMock = mock(() => Promise.resolve({ error: null }));
    mockUpdate.mockImplementationOnce(() => ({ eq: eqMock }));

    const result = await setBrandDealEngineEnabled("brand-asv-uuid", true);

    expect(mockFrom).toHaveBeenCalledWith("qb_brands");
    expect(mockUpdate).toHaveBeenCalledWith({ discount_configured: true });
    expect(eqMock).toHaveBeenCalledWith("id", "brand-asv-uuid");
    expect(result).toEqual({ ok: true });
  });

  test("setBrandDealEngineEnabled surfaces DB error messages", async () => {
    const eqMock = mock(() => Promise.resolve({ error: { message: "rls: forbidden" } }));
    mockUpdate.mockImplementationOnce(() => ({ eq: eqMock }));
    const result = await setBrandDealEngineEnabled("b-1", false);
    expect(result).toEqual({ error: "rls: forbidden" });
  });

  test("isBrandQuoteReady requires ≥1 published sheet AND ≥1 freight zone", () => {
    const base = {
      id: "b", code: "X", name: "X",
      discount_configured: false, has_inbound_freight_key: false,
      published_sheet_count: 0, freight_zone_count: 0, active_program_count: 0,
    };
    expect(isBrandQuoteReady(base)).toBe(false);
    expect(isBrandQuoteReady({ ...base, published_sheet_count: 1 })).toBe(false);
    expect(isBrandQuoteReady({ ...base, freight_zone_count: 1 })).toBe(false);
    expect(isBrandQuoteReady({ ...base, published_sheet_count: 1, freight_zone_count: 1 })).toBe(true);
  });

  test("missingPrereqs lists only the missing required items", () => {
    const base = {
      id: "b", code: "X", name: "X",
      discount_configured: false, has_inbound_freight_key: false,
      published_sheet_count: 0, freight_zone_count: 0, active_program_count: 0,
    };
    expect(missingPrereqs(base)).toEqual(["price sheet", "freight zones"]);
    expect(missingPrereqs({ ...base, published_sheet_count: 1 })).toEqual(["freight zones"]);
    expect(missingPrereqs({ ...base, published_sheet_count: 1, freight_zone_count: 1 })).toEqual([]);
    // Programs and freight key are NOT required — absence shouldn't appear
    expect(missingPrereqs({
      ...base,
      published_sheet_count: 1,
      freight_zone_count: 1,
      active_program_count: 0,
      has_inbound_freight_key: false,
    })).toEqual([]);
  });
});
