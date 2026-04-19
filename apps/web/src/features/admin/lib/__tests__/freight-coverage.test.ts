import { describe, expect, test } from "bun:test";
import {
  analyzeFreightCoverage,
  parseDollarInput,
  formatCentsAsDollars,
  type FreightZone,
} from "../price-sheets-api";

function makeZone(id: string, stateCodes: string[]): FreightZone {
  return {
    id,
    workspace_id: "ws",
    brand_id: "brand-asv",
    zone_name: id,
    state_codes: stateCodes,
    freight_large_cents: 100000,
    freight_small_cents: 50000,
    effective_from: null,
    effective_to: null,
    created_at: "2026-01-01T00:00:00Z",
  } as FreightZone;
}

describe("analyzeFreightCoverage", () => {
  test("no zones → all 51 uncovered, 0 covered, 0 overlaps", () => {
    const r = analyzeFreightCoverage([]);
    expect(r.covered).toHaveLength(0);
    expect(r.uncovered).toHaveLength(51);
    expect(r.overlaps).toHaveLength(0);
    expect(r.uncovered).toContain("FL");
    expect(r.uncovered).toContain("CA");
    expect(r.uncovered).toContain("DC");
  });

  test("clean split: 3 zones covering 15 distinct states", () => {
    const zones = [
      makeZone("z1", ["FL", "GA", "AL", "MS", "TN"]),
      makeZone("z2", ["TX", "OK", "AR", "LA"]),
      makeZone("z3", ["CA", "NV", "AZ", "UT", "CO", "NM"]),
    ];
    const r = analyzeFreightCoverage(zones);
    expect(r.covered).toHaveLength(15);
    expect(r.uncovered).toHaveLength(36);
    expect(r.overlaps).toHaveLength(0);
    expect(r.covered).toContain("FL");
    expect(r.uncovered).toContain("NY");
  });

  test("overlap: FL in two zones → overlaps has one entry with both zone_ids", () => {
    const zones = [
      makeZone("z1", ["FL", "GA"]),
      makeZone("z2", ["FL", "AL"]),
    ];
    const r = analyzeFreightCoverage(zones);
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0].state_code).toBe("FL");
    expect(r.overlaps[0].zone_ids).toHaveLength(2);
    expect(r.overlaps[0].zone_ids).toContain("z1");
    expect(r.overlaps[0].zone_ids).toContain("z2");
    // FL should still appear in covered (1 coverage + 1 overlap ≠ excluded)
    expect(r.covered).toContain("FL");
  });

  test("dedup: duplicate state within one zone does NOT create false overlap", () => {
    const zones = [makeZone("z1", ["FL", "FL", "GA"])];
    const r = analyzeFreightCoverage(zones);
    expect(r.overlaps).toHaveLength(0);
    expect(r.covered).toContain("FL");
    expect(r.covered).toContain("GA");
  });

  test("three-way overlap: same state in three zones", () => {
    const zones = [
      makeZone("z1", ["TX"]),
      makeZone("z2", ["TX"]),
      makeZone("z3", ["TX"]),
    ];
    const r = analyzeFreightCoverage(zones);
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0].zone_ids).toHaveLength(3);
  });

  test("empty state_codes array on a zone is ignored safely", () => {
    const zones = [makeZone("z1", []), makeZone("z2", ["NY"])];
    const r = analyzeFreightCoverage(zones);
    expect(r.covered).toEqual(["NY"]);
    expect(r.overlaps).toHaveLength(0);
  });
});

describe("parseDollarInput", () => {
  test("happy path: '1942' → 194200", () => {
    expect(parseDollarInput("1942")).toBe(194200);
  });

  test("dollar sign + comma: '$1,942.00' → 194200", () => {
    expect(parseDollarInput("$1,942.00")).toBe(194200);
  });

  test("decimal without trailing zero: '1942.5' → 194250", () => {
    expect(parseDollarInput("1942.5")).toBe(194250);
  });

  test("leading decimal: '.50' → 50", () => {
    expect(parseDollarInput(".50")).toBe(50);
  });

  test("zero: '0' → 0", () => {
    expect(parseDollarInput("0")).toBe(0);
  });

  test("empty string → null", () => {
    expect(parseDollarInput("")).toBeNull();
    expect(parseDollarInput("   ")).toBeNull();
  });

  test("non-numeric chars → null", () => {
    expect(parseDollarInput("abc")).toBeNull();
    expect(parseDollarInput("1942abc")).toBeNull();
    expect(parseDollarInput("-5")).toBeNull();
  });

  test("too many decimal places → null (3 or more)", () => {
    expect(parseDollarInput("1942.123")).toBeNull();
  });
});

describe("formatCentsAsDollars", () => {
  test("happy path: 194200 → '1,942.00'", () => {
    expect(formatCentsAsDollars(194200)).toBe("1,942.00");
  });

  test("zero: 0 → '0.00'", () => {
    expect(formatCentsAsDollars(0)).toBe("0.00");
  });

  test("under a dollar: 50 → '0.50'", () => {
    expect(formatCentsAsDollars(50)).toBe("0.50");
  });

  test("single-cent precision: 194205 → '1,942.05'", () => {
    expect(formatCentsAsDollars(194205)).toBe("1,942.05");
  });

  test("large number: 12345678 → '123,456.78'", () => {
    expect(formatCentsAsDollars(12345678)).toBe("123,456.78");
  });

  test("null/undefined → empty string", () => {
    expect(formatCentsAsDollars(null)).toBe("");
    expect(formatCentsAsDollars(undefined)).toBe("");
  });

  test("roundtrip: parse → format → parse", () => {
    const cents = parseDollarInput("$1,942.50")!;
    expect(cents).toBe(194250);
    expect(formatCentsAsDollars(cents)).toBe("1,942.50");
    expect(parseDollarInput(formatCentsAsDollars(cents))).toBe(194250);
  });
});
