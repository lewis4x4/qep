/**
 * Tests for the Phase 0 P0.5 Iron role blend helpers.
 *
 * Run with: bun test apps/web/src/features/qrm/lib/iron-roles.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  getDominantIronRoleFromBlend,
  getEffectiveIronRole,
  getIronRole,
  getIronRoleBlend,
  isIronBlendElevated,
  isIronElevated,
  type IronRoleBlendInput,
} from "./iron-roles";

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
