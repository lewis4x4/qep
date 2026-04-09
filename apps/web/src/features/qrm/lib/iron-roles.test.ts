/**
 * Tests for the Phase 0 P0.5 Iron role blend helpers.
 *
 * Run with: bun test apps/web/src/features/qrm/lib/iron-roles.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  coerceBlendRowsFromView,
  getDominantIronRoleFromBlend,
  getEffectiveIronRole,
  getIronRole,
  getIronRoleBlend,
  isIronBlendElevated,
  isIronElevated,
  isIronRole,
  resolveIronRoleAndBlend,
  type IronRoleBlendInput,
} from "./iron-roles";

// ─── isIronRole (canonical narrower) ─────────────────────────────────────────

describe("isIronRole", () => {
  test("accepts all four valid Iron roles", () => {
    expect(isIronRole("iron_advisor")).toBe(true);
    expect(isIronRole("iron_manager")).toBe(true);
    expect(isIronRole("iron_woman")).toBe(true);
    expect(isIronRole("iron_man")).toBe(true);
  });

  test("rejects unrecognized strings", () => {
    expect(isIronRole("garbage")).toBe(false);
    expect(isIronRole("iron_grandmaster")).toBe(false);
    expect(isIronRole("manager")).toBe(false);
  });

  test("rejects empty string and whitespace", () => {
    expect(isIronRole("")).toBe(false);
    expect(isIronRole("   ")).toBe(false);
  });

  test("rejects null and undefined", () => {
    expect(isIronRole(null)).toBe(false);
    expect(isIronRole(undefined)).toBe(false);
  });
});

// ─── coerceBlendRowsFromView (frontend narrower for view rows) ───────────────

describe("coerceBlendRowsFromView", () => {
  test("accepts a clean single-role-1.0 row", () => {
    const out = coerceBlendRowsFromView([{ iron_role: "iron_advisor", weight: 1.0 }]);
    expect(out.length).toBe(1);
    expect(out[0].iron_role).toBe("iron_advisor");
    expect(out[0].weight).toBe(1.0);
  });

  test("coerces stringified numeric weights (Postgres NUMERIC → JSON string)", () => {
    // Supabase JS client returns Postgres NUMERIC columns as strings by default.
    // The narrower must coerce them to JS numbers without dropping the row.
    const out = coerceBlendRowsFromView([
      { iron_role: "iron_manager", weight: "0.6" as unknown as number },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].weight).toBe(0.6);
  });

  test("drops rows with unrecognized iron_role values", () => {
    const out = coerceBlendRowsFromView([
      { iron_role: "iron_advisor", weight: 0.5 },
      { iron_role: "iron_grandmaster", weight: 0.5 },
      { iron_role: 42 as unknown as string, weight: 0.5 },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].iron_role).toBe("iron_advisor");
  });

  test("drops rows with bad weights (NaN, ≤ 0, > 1, non-numeric)", () => {
    const out = coerceBlendRowsFromView([
      { iron_role: "iron_advisor", weight: 0.5 },
      { iron_role: "iron_manager", weight: 0 }, // tombstone
      { iron_role: "iron_woman", weight: -0.1 }, // negative
      { iron_role: "iron_man", weight: 1.5 }, // out of range
      { iron_role: "iron_advisor", weight: NaN },
      { iron_role: "iron_manager", weight: "not-a-number" as unknown as number },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].iron_role).toBe("iron_advisor");
  });

  test("handles empty / null / undefined input", () => {
    expect(coerceBlendRowsFromView([]).length).toBe(0);
    expect(coerceBlendRowsFromView(null).length).toBe(0);
    expect(coerceBlendRowsFromView(undefined).length).toBe(0);
  });

  test("skips null entries inside the array", () => {
    const out = coerceBlendRowsFromView([
      null,
      undefined,
      { iron_role: "iron_advisor", weight: 1.0 },
    ]);
    expect(out.length).toBe(1);
  });

  test("output feeds getIronRoleBlend cleanly (round-trip parity)", () => {
    // Wire-level parity: the rows that survive coerceBlendRowsFromView must
    // also survive getIronRoleBlend. Two narrowers, two passes, same result.
    const rawRows = [
      { iron_role: "iron_manager", weight: "0.6" as unknown as number },
      { iron_role: "iron_advisor", weight: 0.4 },
      { iron_role: "iron_grandmaster", weight: 0.5 }, // dropped
    ];
    const coerced = coerceBlendRowsFromView(rawRows);
    expect(coerced.length).toBe(2);
    const blend = getIronRoleBlend(coerced);
    expect(blend.length).toBe(2);
    // getIronRoleBlend sorts by weight DESC, so manager (0.6) is first
    expect(blend[0].role).toBe("iron_manager");
    expect(blend[1].role).toBe("iron_advisor");
  });
});

// ─── getIronRole (legacy shim) ───────────────────────────────────────────────

describe("getIronRole (legacy shim)", () => {
  test("prefers iron_role from profile when valid", () => {
    expect(getIronRole("rep", "iron_man").role).toBe("iron_man");
    expect(getIronRole("rep", "iron_woman").role).toBe("iron_woman");
  });

  test("falls back to legacy map when profile iron_role is null", () => {
    expect(getIronRole("manager", null).role).toBe("iron_manager");
    expect(getIronRole("owner", null).role).toBe("iron_manager");
    expect(getIronRole("admin", null).role).toBe("iron_woman");
    expect(getIronRole("rep", null).role).toBe("iron_advisor");
  });

  test("ignores invalid iron_role string and falls back to legacy map", () => {
    expect(getIronRole("manager", "garbage").role).toBe("iron_manager");
    expect(getIronRole("rep", "iron_grandmaster").role).toBe("iron_advisor");
  });

  test("defaults to iron_advisor for unknown system role", () => {
    // @ts-expect-error — testing the fallback path with an off-enum value
    expect(getIronRole("unknown_role", null).role).toBe("iron_advisor");
  });
});

describe("isIronElevated (legacy shim)", () => {
  test("manager is elevated", () => {
    expect(isIronElevated("manager", null)).toBe(true);
  });

  test("rep is not elevated", () => {
    expect(isIronElevated("rep", null)).toBe(false);
  });

  test("admin (iron_woman) is not elevated", () => {
    expect(isIronElevated("admin", null)).toBe(false);
  });

  test("profile iron_role overrides system role", () => {
    expect(isIronElevated("rep", "iron_manager")).toBe(true);
    expect(isIronElevated("manager", "iron_advisor")).toBe(false);
  });
});

// ─── getIronRoleBlend ────────────────────────────────────────────────────────

describe("getIronRoleBlend", () => {
  test("returns empty array for null/undefined input", () => {
    expect(getIronRoleBlend(null)).toEqual([]);
    expect(getIronRoleBlend(undefined)).toEqual([]);
    expect(getIronRoleBlend([])).toEqual([]);
  });

  test("normalizes a single-role blend (1.0 weight)", () => {
    const rows: IronRoleBlendInput[] = [{ iron_role: "iron_advisor", weight: 1.0 }];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(1);
    expect(blend[0].role).toBe("iron_advisor");
    expect(blend[0].display).toBe("Iron Advisor");
    expect(blend[0].weight).toBe(1.0);
  });

  test("sorts by weight DESC so dominant role is at index 0", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 0.4 },
      { iron_role: "iron_manager", weight: 0.6 },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(2);
    expect(blend[0].role).toBe("iron_manager");
    expect(blend[0].weight).toBe(0.6);
    expect(blend[1].role).toBe("iron_advisor");
    expect(blend[1].weight).toBe(0.4);
  });

  test("preserves all four roles in a maximally-blended profile", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_man", weight: 0.1 },
      { iron_role: "iron_advisor", weight: 0.4 },
      { iron_role: "iron_manager", weight: 0.3 },
      { iron_role: "iron_woman", weight: 0.2 },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(4);
    expect(blend.map((e) => e.role)).toEqual([
      "iron_advisor",
      "iron_manager",
      "iron_woman",
      "iron_man",
    ]);
  });

  test("drops rows with unrecognized iron_role values", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 0.5 },
      { iron_role: "iron_grandmaster", weight: 0.5 },
      // @ts-expect-error — non-string iron_role rejected at runtime
      { iron_role: 42, weight: 0.5 },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(1);
    expect(blend[0].role).toBe("iron_advisor");
  });

  test("drops rows with non-numeric weight", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 0.5 },
      // @ts-expect-error — string weight rejected at runtime
      { iron_role: "iron_manager", weight: "high" },
      { iron_role: "iron_woman", weight: NaN },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(1);
    expect(blend[0].role).toBe("iron_advisor");
  });

  test("drops rows with weight <= 0 (tombstones)", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 1.0 },
      { iron_role: "iron_manager", weight: 0 },
      { iron_role: "iron_woman", weight: -0.5 },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(1);
    expect(blend[0].role).toBe("iron_advisor");
  });

  test("drops rows with weight > 1 (defensive)", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 1.0 },
      { iron_role: "iron_manager", weight: 1.5 },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(1);
    expect(blend[0].role).toBe("iron_advisor");
  });

  test("does NOT normalize weights to sum to 1.0 (drift is a P0.6 concern)", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 0.3 },
      { iron_role: "iron_manager", weight: 0.3 },
    ];
    const blend = getIronRoleBlend(rows);
    expect(blend.length).toBe(2);
    const sum = blend.reduce((acc, e) => acc + e.weight, 0);
    expect(sum).toBe(0.6); // unchanged — caller must normalize if needed
  });
});

// ─── getDominantIronRoleFromBlend ────────────────────────────────────────────

describe("getDominantIronRoleFromBlend", () => {
  test("returns null for empty blend", () => {
    expect(getDominantIronRoleFromBlend([])).toBeNull();
    expect(getDominantIronRoleFromBlend(null)).toBeNull();
    expect(getDominantIronRoleFromBlend(undefined)).toBeNull();
  });

  test("returns the entry at index 0 (already sorted by weight DESC)", () => {
    const blend = getIronRoleBlend([
      { iron_role: "iron_advisor", weight: 0.4 },
      { iron_role: "iron_manager", weight: 0.6 },
    ]);
    const dominant = getDominantIronRoleFromBlend(blend);
    expect(dominant).not.toBeNull();
    expect(dominant!.role).toBe("iron_manager");
  });
});

// ─── getEffectiveIronRole ───────────────────────────────────────────────────

describe("getEffectiveIronRole", () => {
  test("returns dominant blend role when blend is non-empty", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 0.4 },
      { iron_role: "iron_manager", weight: 0.6 },
    ];
    expect(getEffectiveIronRole("rep", rows, null).role).toBe("iron_manager");
  });

  test("falls back to profile iron_role when blend is empty", () => {
    expect(getEffectiveIronRole("rep", [], "iron_man").role).toBe("iron_man");
    expect(getEffectiveIronRole("rep", null, "iron_man").role).toBe("iron_man");
  });

  test("falls back to legacy map when blend AND profile iron_role are absent", () => {
    expect(getEffectiveIronRole("manager", null, null).role).toBe("iron_manager");
    expect(getEffectiveIronRole("rep", null, null).role).toBe("iron_advisor");
  });

  test("blend overrides profile iron_role even when both are present", () => {
    // The blend is the authoritative shape — profile iron_role is the
    // backwards-compat shim. When both exist, blend wins.
    const rows: IronRoleBlendInput[] = [{ iron_role: "iron_advisor", weight: 1.0 }];
    expect(getEffectiveIronRole("manager", rows, "iron_manager").role).toBe("iron_advisor");
  });

  test("blend with only invalid rows is treated as empty (falls through)", () => {
    const rows: IronRoleBlendInput[] = [{ iron_role: "iron_grandmaster", weight: 1.0 }];
    expect(getEffectiveIronRole("manager", rows, null).role).toBe("iron_manager");
  });
});

// ─── isIronBlendElevated ─────────────────────────────────────────────────────

// ─── resolveIronRoleAndBlend (single-pass parser) ────────────────────────────

describe("resolveIronRoleAndBlend", () => {
  test("returns dominant role + parsed blend in a single call", () => {
    const rows: IronRoleBlendInput[] = [
      { iron_role: "iron_advisor", weight: 0.4 },
      { iron_role: "iron_manager", weight: 0.6 },
    ];
    const { info, blend } = resolveIronRoleAndBlend("rep", rows, null);
    expect(info.role).toBe("iron_manager");
    expect(blend.length).toBe(2);
    expect(blend[0].role).toBe("iron_manager");
    expect(blend[1].role).toBe("iron_advisor");
  });

  test("returns empty blend + legacy fallback when blend is empty", () => {
    const { info, blend } = resolveIronRoleAndBlend("manager", [], null);
    expect(info.role).toBe("iron_manager");
    expect(blend).toEqual([]);
  });

  test("returns empty blend + profile iron_role when blend rows are null", () => {
    const { info, blend } = resolveIronRoleAndBlend("rep", null, "iron_man");
    expect(info.role).toBe("iron_man");
    expect(blend).toEqual([]);
  });

  test("blend overrides profile iron_role even when both are present", () => {
    const rows: IronRoleBlendInput[] = [{ iron_role: "iron_advisor", weight: 1.0 }];
    const { info, blend } = resolveIronRoleAndBlend("manager", rows, "iron_manager");
    expect(info.role).toBe("iron_advisor");
    expect(blend.length).toBe(1);
  });

  test("matches getEffectiveIronRole + getIronRoleBlend exactly", () => {
    // Regression: the single-pass helper must produce IDENTICAL results to
    // calling the two helpers separately, otherwise the refactor would
    // change page behavior.
    const cases: Array<[string, IronRoleBlendInput[] | null, string | null]> = [
      ["rep", [{ iron_role: "iron_advisor", weight: 1.0 }], null],
      ["manager", null, "iron_manager"],
      ["rep", [{ iron_role: "iron_manager", weight: 0.6 }, { iron_role: "iron_advisor", weight: 0.4 }], null],
      ["admin", [], null],
      ["rep", [{ iron_role: "iron_grandmaster", weight: 1.0 }], null], // invalid → fallback
    ];
    for (const [userRole, rows, profile] of cases) {
      const single = resolveIronRoleAndBlend(userRole as "rep" | "manager" | "admin", rows, profile);
      const expectedInfo = getEffectiveIronRole(userRole as "rep" | "manager" | "admin", rows, profile);
      const expectedBlend = getIronRoleBlend(rows);
      expect(single.info.role).toBe(expectedInfo.role);
      expect(single.blend.length).toBe(expectedBlend.length);
      expect(single.blend.map((e) => e.role)).toEqual(expectedBlend.map((e) => e.role));
    }
  });
});

describe("isIronBlendElevated", () => {
  test("returns false for empty blend", () => {
    expect(isIronBlendElevated([])).toBe(false);
    expect(isIronBlendElevated(null)).toBe(false);
    expect(isIronBlendElevated(undefined)).toBe(false);
  });

  test("returns true when iron_manager is dominant", () => {
    const blend = getIronRoleBlend([{ iron_role: "iron_manager", weight: 1.0 }]);
    expect(isIronBlendElevated(blend)).toBe(true);
  });

  test("returns true when iron_manager is non-dominant but present (cover case)", () => {
    // The "any" semantics: a manager covering an advisor at 0.4 weight is
    // STILL elevated for approval-gate purposes.
    const blend = getIronRoleBlend([
      { iron_role: "iron_advisor", weight: 0.6 },
      { iron_role: "iron_manager", weight: 0.4 },
    ]);
    expect(isIronBlendElevated(blend)).toBe(true);
  });

  test("returns false when no manager is in the blend", () => {
    const blend = getIronRoleBlend([
      { iron_role: "iron_advisor", weight: 0.5 },
      { iron_role: "iron_woman", weight: 0.5 },
    ]);
    expect(isIronBlendElevated(blend)).toBe(false);
  });
});
