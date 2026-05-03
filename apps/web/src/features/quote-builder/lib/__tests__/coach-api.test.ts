import { describe, expect, test } from "bun:test";
import {
  median,
  normalizeCoachBrandRows,
  normalizeCoachProgramRows,
  normalizeDismissedRuleIds,
  normalizeMarginPctRows,
} from "../coach-api";

describe("deal coach API normalizers", () => {
  test("normalizeMarginPctRows coerces numeric strings and filters malformed rows", () => {
    expect(normalizeMarginPctRows([
      { margin_pct: 18.5 },
      { margin_pct: "21.25" },
      { margin_pct: "bad" },
      {},
      null,
    ])).toEqual([18.5, 21.25]);
  });

  test("normalizeCoachBrandRows requires brand identity", () => {
    expect(normalizeCoachBrandRows([
      { id: "brand-1", name: "ASV", code: "ASV" },
      { id: "brand-2", name: "", code: "BAD" },
      { name: "Missing id" },
    ])).toEqual([
      { id: "brand-1", name: "ASV", code: "ASV" },
    ]);
  });

  test("normalizeCoachProgramRows maps active programs with brand names", () => {
    const brandNameById = new Map([["brand-1", "ASV"]]);

    expect(normalizeCoachProgramRows([
      {
        id: "program-1",
        program_code: "CIL-Q2",
        program_type: "cash_in_lieu",
        name: "Q2 Cash",
        brand_id: "brand-1",
      },
      { id: "bad", program_code: "BAD", brand_id: "brand-1" },
      {
        id: "program-2",
        program_code: "LRF-Q2",
        program_type: "low_rate_financing",
        name: "Q2 Low Rate",
        brand_id: "missing-brand",
      },
    ], brandNameById)).toEqual([
      {
        programId: "program-1",
        programCode: "CIL-Q2",
        programType: "cash_in_lieu",
        programName: "Q2 Cash",
        brandName: "ASV",
      },
      {
        programId: "program-2",
        programCode: "LRF-Q2",
        programType: "low_rate_financing",
        programName: "Q2 Low Rate",
        brandName: "Unknown",
      },
    ]);
  });

  test("normalizeDismissedRuleIds filters blank and malformed rows", () => {
    expect(normalizeDismissedRuleIds([
      { rule_id: "margin_baseline" },
      { rule_id: "" },
      {},
    ])).toEqual(["margin_baseline"]);
  });
});

describe("median", () => {
  test("returns null for empty inputs", () => {
    expect(median([])).toBeNull();
  });

  test("computes odd and even medians without mutating input", () => {
    const values = [30, 10, 20];

    expect(median(values)).toBe(20);
    expect(values).toEqual([30, 10, 20]);
    expect(median([10, 40, 20, 30])).toBe(25);
  });
});
