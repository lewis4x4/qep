/**
 * Unit tests: price sheet ingestion diff engine
 *
 * Tests detectModelAction, detectAttachmentAction, detectFreightZoneAction.
 * All DB I/O is replaced with stub SupabaseLike objects — no real DB calls.
 */

import { describe, it, expect } from "bun:test";
import {
  detectModelAction,
  detectAttachmentAction,
  detectFreightZoneAction,
  type ExtractedModel,
  type ExtractedAttachment,
  type ExtractedFreightZone,
} from "../ingestion.ts";

// ── Stub helpers ──────────────────────────────────────────────────────────────

const BRAND_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const EXISTING_MODEL_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const EXISTING_ATTACH_ID = "cccccccc-0000-0000-0000-000000000003";
const EXISTING_FREIGHT_ID = "dddddddd-0000-0000-0000-000000000004";

/** Returns a stub supabase that resolves .maybeSingle() with the given row (or null). */
function stubSupabase(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
          contains: () => ({ maybeSingle: async () => ({ data: row, error }) }),
          maybeSingle: async () => ({ data: row, error }),
        }),
        contains: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      }),
    }),
  };
}

// ── detectModelAction ─────────────────────────────────────────────────────────

describe("detectModelAction", () => {
  const baseModel: ExtractedModel = {
    model_code: "RT-135",
    family: "Compact Track Loader",
    name_display: "RT-135 Open ROPS Base",
    standard_config: "Open ROPS, standard hydraulics",
    list_price_cents: 6_214_900,
  };

  it("returns create when model not in catalog", async () => {
    const result = await detectModelAction(baseModel, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("create");
    expect(result.confidence).toBe(1.0);
    expect(result.existingId).toBeUndefined();
  });

  it("returns no_change when all fields match", async () => {
    const existing = {
      id: EXISTING_MODEL_ID,
      model_code: "RT-135",
      list_price_cents: 6_214_900,
      standard_config: "Open ROPS, standard hydraulics",
      family: "Compact Track Loader",
      name_display: "RT-135 Open ROPS Base",
      specs: null,
    };
    const result = await detectModelAction(baseModel, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("no_change");
    expect(result.existingId).toBe(EXISTING_MODEL_ID);
  });

  it("returns update with correct diff when list price changed", async () => {
    const existing = {
      id: EXISTING_MODEL_ID,
      model_code: "RT-135",
      list_price_cents: 6_000_000, // old price
      standard_config: "Open ROPS, standard hydraulics",
      family: "Compact Track Loader",
      name_display: "RT-135 Open ROPS Base",
      specs: null,
    };
    const result = await detectModelAction(baseModel, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("update");
    expect(result.existingId).toBe(EXISTING_MODEL_ID);
    expect(result.changes?.list_price_cents).toEqual({ old: 6_000_000, new: 6_214_900 });
    expect(result.confidence).toBe(0.95);
  });

  it("returns update when standard_config changed", async () => {
    const existing = {
      id: EXISTING_MODEL_ID,
      model_code: "RT-135",
      list_price_cents: 6_214_900,
      standard_config: "OLD config",
      family: "Compact Track Loader",
      name_display: "RT-135 Open ROPS Base",
      specs: null,
    };
    const result = await detectModelAction(baseModel, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("update");
    expect(result.changes?.standard_config?.old).toBe("OLD config");
    expect(result.changes?.standard_config?.new).toBe("Open ROPS, standard hydraulics");
  });

  it("skips when model_code is missing", async () => {
    const bad = { ...baseModel, model_code: "" };
    const result = await detectModelAction(bad, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/model_code/i);
  });

  it("skips when list_price_cents is zero", async () => {
    const bad = { ...baseModel, list_price_cents: 0 };
    const result = await detectModelAction(bad, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/list_price_cents/i);
  });

  it("skips on DB error", async () => {
    const result = await detectModelAction(baseModel, BRAND_ID, stubSupabase(null, { message: "connection refused" }));
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/DB lookup failed/i);
    expect(result.confidence).toBe(0.0);
  });
});

// ── detectAttachmentAction ────────────────────────────────────────────────────

describe("detectAttachmentAction", () => {
  const baseAttach: ExtractedAttachment = {
    part_number: "RT-THUMB-01",
    name: "Hydraulic Thumb — RT Series",
    category: "thumb",
    list_price_cents: 325_000,
    attachment_type: "field_install",
    compatible_model_codes: ["RT-65", "RT-75", "RT-100", "RT-135"],
  };

  it("returns create for new attachment", async () => {
    const result = await detectAttachmentAction(baseAttach, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("create");
    expect(result.confidence).toBe(1.0);
  });

  it("returns no_change when all fields match", async () => {
    const existing = {
      id: EXISTING_ATTACH_ID,
      part_number: "RT-THUMB-01",
      name: "Hydraulic Thumb — RT Series",
      list_price_cents: 325_000,
      category: "thumb",
      attachment_type: "field_install",
    };
    const result = await detectAttachmentAction(baseAttach, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("no_change");
    expect(result.existingId).toBe(EXISTING_ATTACH_ID);
  });

  it("returns update when price changes", async () => {
    const existing = {
      id: EXISTING_ATTACH_ID,
      part_number: "RT-THUMB-01",
      name: "Hydraulic Thumb — RT Series",
      list_price_cents: 300_000,
      category: "thumb",
      attachment_type: "field_install",
    };
    const result = await detectAttachmentAction(baseAttach, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("update");
    expect(result.changes?.list_price_cents).toEqual({ old: 300_000, new: 325_000 });
  });

  it("skips when part_number is missing", async () => {
    const bad = { ...baseAttach, part_number: "" };
    const result = await detectAttachmentAction(bad, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/part_number/i);
  });

  it("skips when list_price_cents is zero", async () => {
    const bad = { ...baseAttach, list_price_cents: 0 };
    const result = await detectAttachmentAction(bad, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("skip");
  });
});

// ── detectFreightZoneAction ───────────────────────────────────────────────────

describe("detectFreightZoneAction", () => {
  const baseFreight: ExtractedFreightZone = {
    state_codes: ["FL"],
    zone_name: "Florida",
    freight_large_cents: 194_200,
    freight_small_cents: 77_700,
  };

  it("returns create for new freight zone", async () => {
    const result = await detectFreightZoneAction(baseFreight, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("create");
    expect(result.confidence).toBe(0.9);
  });

  it("returns no_change when freight amounts match", async () => {
    const existing = {
      id: EXISTING_FREIGHT_ID,
      state_codes: ["FL"],
      freight_large_cents: 194_200,
      freight_small_cents: 77_700,
      zone_name: "Florida",
    };
    const result = await detectFreightZoneAction(baseFreight, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("no_change");
    expect(result.existingId).toBe(EXISTING_FREIGHT_ID);
  });

  it("returns update when freight_large_cents changed", async () => {
    const existing = {
      id: EXISTING_FREIGHT_ID,
      state_codes: ["FL"],
      freight_large_cents: 185_000,
      freight_small_cents: 77_700,
      zone_name: "Florida",
    };
    const result = await detectFreightZoneAction(baseFreight, BRAND_ID, stubSupabase(existing));
    expect(result.action).toBe("update");
    expect(result.changes?.freight_large_cents).toEqual({ old: 185_000, new: 194_200 });
  });

  it("skips when state_codes is empty", async () => {
    const bad = { ...baseFreight, state_codes: [] };
    const result = await detectFreightZoneAction(bad, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("skip");
    expect(result.skipReason).toMatch(/state_codes/i);
  });

  it("skips when freight amounts are zero", async () => {
    const bad = { ...baseFreight, freight_large_cents: 0 };
    const result = await detectFreightZoneAction(bad, BRAND_ID, stubSupabase(null));
    expect(result.action).toBe("skip");
  });
});
