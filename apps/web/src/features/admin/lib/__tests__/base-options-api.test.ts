import { describe, expect, test } from "bun:test";

import {
  normalizeBaseOptionAttachmentRows,
  normalizeBaseOptionModelRows,
} from "../base-options-api";

describe("base-options API normalizers", () => {
  test("normalizes model rows with joined brand arrays and numeric strings", () => {
    expect(normalizeBaseOptionModelRows([
      {
        id: "model-1",
        brand_id: "brand-1",
        model_code: "RT75",
        family: "CTL",
        name_display: "ASV RT-75",
        standard_config: "Cab",
        list_price_cents: "12500000",
        active: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        qb_brands: [{ id: "brand-1", code: "ASV", name: "ASV" }],
      },
    ])).toEqual([
      {
        id: "model-1",
        brandId: "brand-1",
        brandCode: "ASV",
        brandName: "ASV",
        modelCode: "RT75",
        family: "CTL",
        nameDisplay: "ASV RT-75",
        standardConfig: "Cab",
        listPriceCents: 12_500_000,
        active: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ]);
  });

  test("filters malformed model rows before the admin page consumes them", () => {
    expect(normalizeBaseOptionModelRows([
      null,
      { id: "missing-brand", model_code: "X", name_display: "Bad" },
      {
        id: "model-2",
        brand_id: "brand-2",
        model_code: "X100",
        name_display: "X100",
        active: "yes",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
    ])).toEqual([
      {
        id: "model-2",
        brandId: "brand-2",
        brandCode: "",
        brandName: "",
        modelCode: "X100",
        family: null,
        nameDisplay: "X100",
        standardConfig: null,
        listPriceCents: 0,
        active: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
    ]);
  });

  test("normalizes attachment rows and cleans compatible model ids", () => {
    expect(normalizeBaseOptionAttachmentRows([
      {
        id: "attachment-1",
        brand_id: "brand-1",
        part_number: "BUCKET-72",
        name: "72 inch bucket",
        category: "bucket",
        list_price_cents: "250000",
        compatible_model_ids: ["model-1", "", 42, "model-2"],
        universal: true,
        active: true,
        updated_at: "2026-01-03T00:00:00Z",
      },
      { id: "bad-attachment", name: "Missing part number" },
    ])).toEqual([
      {
        id: "attachment-1",
        brandId: "brand-1",
        partNumber: "BUCKET-72",
        name: "72 inch bucket",
        category: "bucket",
        listPriceCents: 250_000,
        compatibleModelIds: ["model-1", "model-2"],
        universal: true,
        active: true,
        updatedAt: "2026-01-03T00:00:00Z",
      },
    ]);
  });

  test("returns safe empty arrays for malformed payloads", () => {
    expect(normalizeBaseOptionModelRows({})).toEqual([]);
    expect(normalizeBaseOptionAttachmentRows("not rows")).toEqual([]);
  });
});
