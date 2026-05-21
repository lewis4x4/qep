import { describe, expect, test } from "bun:test";
import {
  formatCentsAsDollars,
  normalizeOemRows,
  normalizeResolvedOemCost,
  parseDollarInput,
} from "../oems-api";

describe("oems-api normalizers", () => {
  test("normalizes valid OEM rows and drops invalid rows", () => {
    expect(normalizeOemRows([
      {
        id: "oem-asv",
        oem_key: "asv",
        parent_oem_key: "ycena",
        display_name: "ASV",
        category: "construction",
        source_format: "pdf",
        price_sheet_cadence: "ad_hoc",
        active: true,
      },
      { id: "missing-name", oem_key: "bad" },
    ])).toEqual([
      {
        id: "oem-asv",
        oemKey: "asv",
        parentOemKey: "ycena",
        displayName: "ASV",
        category: "construction",
        sourceFormat: "pdf",
        priceSheetCadence: "ad_hoc",
        active: true,
      },
    ]);
  });

  test("normalizes resolver rows", () => {
    expect(normalizeResolvedOemCost({
      dealer_cost_cents: 7000000,
      discount_off_list_pct: "30.0000",
      tier_id: "tier-1",
      oem_id: "oem-asv",
      parent_oem_key: "ycena",
      brand_key: "asv",
      effective_from: "2026-04-15",
      effective_to: null,
      source_reference: "ASV.pdf",
    })).toEqual({
      dealerCostCents: 7000000,
      discountOffListPct: 30,
      tierId: "tier-1",
      oemId: "oem-asv",
      parentOemKey: "ycena",
      brandKey: "asv",
      effectiveFrom: "2026-04-15",
      effectiveTo: null,
      sourceReference: "ASV.pdf",
    });
  });

  test("parses and formats money", () => {
    expect(parseDollarInput("$100,000.55")).toBe(10000055);
    expect(parseDollarInput("-1")).toBeNull();
    expect(formatCentsAsDollars(7000000)).toBe("$70,000.00");
  });
});
