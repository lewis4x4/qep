/**
 * Unit tests: DB-backed stacking validator
 *
 * Uses a mock Supabase client that returns the same 10 rules seeded in
 * migration 285 — no live DB call.
 */

import { describe, it, expect } from "bun:test";
import { validateStackingFromDB } from "../stacking-db.ts";

// ── Mock Supabase client ──────────────────────────────────────────────────────

const RULES = [
  { program_type_a: "cash_in_lieu",        program_type_b: "low_rate_financing", can_combine: false, notes: "Pick one: CIL or low-rate financing" },
  { program_type_a: "cash_in_lieu",        program_type_b: "aged_inventory",     can_combine: true,  notes: "Aged inventory stacks with CIL" },
  { program_type_a: "low_rate_financing",  program_type_b: "aged_inventory",     can_combine: true,  notes: "Aged inventory stacks with financing" },
  { program_type_a: "gmu_rebate",          program_type_b: "cash_in_lieu",       can_combine: false, notes: "GMU cannot stack with retail incentives" },
  { program_type_a: "gmu_rebate",          program_type_b: "low_rate_financing", can_combine: false, notes: "GMU cannot stack with retail incentives" },
  { program_type_a: "gmu_rebate",          program_type_b: "aged_inventory",     can_combine: false, notes: "GMU cannot stack with retail incentives" },
  { program_type_a: "bridge_rent_to_sales", program_type_b: "cash_in_lieu",      can_combine: false, notes: "Bridge cannot combine with anything" },
  { program_type_a: "bridge_rent_to_sales", program_type_b: "low_rate_financing",can_combine: false, notes: "Bridge cannot combine with anything" },
  { program_type_a: "bridge_rent_to_sales", program_type_b: "aged_inventory",    can_combine: false, notes: "Bridge cannot combine with anything" },
  { program_type_a: "bridge_rent_to_sales", program_type_b: "gmu_rebate",        can_combine: false, notes: "Bridge cannot combine with anything" },
];

function makePrograms(types: Array<{ id: string; type: string; name: string }>) {
  return types.map((t) => ({ id: t.id, program_type: t.type, name: t.name }));
}

function mockSupabase(programRows: object[]) {
  // Returns a chainable mock that resolves each .select().in() or .select() call
  return {
    from: (table: string) => ({
      select: (_cols: string) => ({
        in: (_col: string, _ids: string[]) =>
          Promise.resolve({ data: programRows, error: null }),
        // for rules query (no .in())
        then: undefined,
        data: RULES,
        error: null,
      }),
    }),
  };
}

// Simpler mock: first call returns programs, second call returns rules
function buildMock(programs: object[]) {
  let callCount = 0;
  return {
    from: (_table: string) => ({
      select: (_cols: string) => {
        callCount++;
        return {
          in: (_col: string, _ids: string[]) =>
            Promise.resolve({ data: programs, error: null }),
          // direct resolution for rules (no .in())
          then: (resolve: Function) => {
            return resolve({ data: RULES, error: null });
          },
        };
      },
    }),
  } as any;
}

// Full mock that handles both programs + rules selects
function fullMock(programs: object[]) {
  const responses = [
    { data: programs, error: null }, // programs fetch
    { data: RULES, error: null },    // rules fetch
  ];
  let idx = 0;
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        in: (_col: string, _ids: string[]) => Promise.resolve(responses[idx++]),
        // for selects without .in() (rules fetch)
        [Symbol.asyncIterator]: undefined,
        then: undefined,
        data: RULES, error: null,
      }),
    }),
  } as any;
}

// The cleanest approach: intercept at the from() level
function makeMock(programs: object[]) {
  return {
    from: (table: string) => {
      if (table === "qb_programs") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: programs, error: null }),
          }),
        };
      }
      // qb_program_stacking_rules — no further chaining needed
      return {
        select: () => Promise.resolve({ data: RULES, error: null }),
      };
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validateStackingFromDB", () => {
  it("single program — always valid", async () => {
    const mock = makeMock([{ id: "p1", program_type: "cash_in_lieu", name: "CIL" }]);
    const result = await validateStackingFromDB(
      { programIds: ["p1"], customerType: "standard" },
      mock,
    );
    expect(result.valid).toBe(true);
    expect(result.validProgramIds).toEqual(["p1"]);
    expect(result.violations).toHaveLength(0);
  });

  it("CIL + financing → violation", async () => {
    const progs = [
      { id: "p1", program_type: "cash_in_lieu",       name: "CIL" },
      { id: "p2", program_type: "low_rate_financing",  name: "Financing" },
    ];
    const mock = makeMock(progs);
    const result = await validateStackingFromDB(
      { programIds: ["p1", "p2"], customerType: "standard" },
      mock,
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toMatch(/CIL|financing/i);
    expect(result.validProgramIds).toEqual(["p1"]); // financing blocked
  });

  it("CIL + aged inventory → valid (can stack)", async () => {
    const progs = [
      { id: "p1", program_type: "cash_in_lieu",  name: "CIL" },
      { id: "p2", program_type: "aged_inventory", name: "Aged" },
    ];
    const mock = makeMock(progs);
    const result = await validateStackingFromDB(
      { programIds: ["p1", "p2"], customerType: "standard" },
      mock,
    );
    expect(result.valid).toBe(true);
    expect(result.validProgramIds).toEqual(["p1", "p2"]);
    expect(result.violations).toHaveLength(0);
  });

  it("financing + aged inventory → valid (can stack)", async () => {
    const progs = [
      { id: "p1", program_type: "low_rate_financing", name: "Financing" },
      { id: "p2", program_type: "aged_inventory",      name: "Aged" },
    ];
    const mock = makeMock(progs);
    const result = await validateStackingFromDB(
      { programIds: ["p1", "p2"], customerType: "standard" },
      mock,
    );
    expect(result.valid).toBe(true);
    expect(result.validProgramIds).toEqual(["p1", "p2"]);
  });

  it("GMU customer + CIL → violation (GMU is its own tier)", async () => {
    const progs = [
      { id: "p1", program_type: "gmu_rebate",  name: "GMU" },
      { id: "p2", program_type: "cash_in_lieu", name: "CIL" },
    ];
    const mock = makeMock(progs);
    const result = await validateStackingFromDB(
      { programIds: ["p1", "p2"], customerType: "gmu" },
      mock,
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toMatch(/GMU|gmu/i);
  });

  it("bridge + anything → violation", async () => {
    const progs = [
      { id: "p1", program_type: "bridge_rent_to_sales", name: "Bridge" },
      { id: "p2", program_type: "cash_in_lieu",         name: "CIL" },
    ];
    const mock = makeMock(progs);
    const result = await validateStackingFromDB(
      { programIds: ["p1", "p2"], customerType: "standard" },
      mock,
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toMatch(/bridge|Bridge/i);
  });

  it("empty list → valid", async () => {
    const mock = makeMock([]);
    const result = await validateStackingFromDB(
      { programIds: [], customerType: "standard" },
      mock,
    );
    expect(result.valid).toBe(true);
    expect(result.validProgramIds).toEqual([]);
  });
});
