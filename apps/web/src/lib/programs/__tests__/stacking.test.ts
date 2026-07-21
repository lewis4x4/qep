/**
 * Unit tests: worksheet-backed, exact-program stacking validator.
 */

import { describe, expect, it } from "bun:test";
import { validateStackingFromDB } from "../stacking-db.ts";

type Row = Record<string, unknown>;
type QueryObservation = {
  table: string;
  operation: "in" | "eq" | "lte" | "gte";
  column: string;
  value: unknown;
};

function program(
  id: string,
  type: string,
  name: string,
  options: Partial<Row> = {},
): Row {
  return {
    id,
    workspace_id: "default",
    brand_id: "brand-asv",
    program_type: type,
    name,
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    active: true,
    stack_policy_provenance: "manufacturer_worksheet",
    stack_policy_verified_at: "2026-01-02T00:00:00.000Z",
    ...options,
  };
}

function policy(
  firstId: string,
  secondId: string,
  canCombine: boolean,
  options: Partial<Row> = {},
): Row {
  const [programA, programB] = [firstId, secondId].sort();
  return {
    workspace_id: "default",
    brand_id: "brand-asv",
    program_a_id: programA,
    program_b_id: programB,
    can_combine: canCombine,
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    source_price_sheet_id: "sheet-1",
    reviewed_at: "2026-01-02T00:00:00.000Z",
    status: "published",
    notes: canCombine ? "Worksheet permits this pair" : "Worksheet blocks this pair",
    ...options,
  };
}

class MockQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly rows: Row[],
    private readonly workspaceId: string,
    private readonly table: string,
    private readonly observations: QueryObservation[],
  ) {}

  in(column: string, values: unknown[]): this {
    this.observations.push({ table: this.table, operation: "in", column, value: values });
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  eq(column: string, value: unknown): this {
    this.observations.push({ table: this.table, operation: "eq", column, value });
    this.filters.push((row) => row[column] === value);
    return this;
  }

  lte(column: string, value: string): this {
    this.observations.push({ table: this.table, operation: "lte", column, value });
    this.filters.push((row) => typeof row[column] === "string" && String(row[column]) <= value);
    return this;
  }

  gte(column: string, value: string): this {
    this.observations.push({ table: this.table, operation: "gte", column, value });
    this.filters.push((row) => typeof row[column] === "string" && String(row[column]) >= value);
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.rows.filter((row) =>
      (row.workspace_id == null || row.workspace_id === this.workspaceId)
      && this.filters.every((filter) => filter(row))
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function makeMock(
  programs: Row[],
  policies: Row[],
  workspaceId = "default",
  observations: QueryObservation[] = [],
) {
  return {
    from: (table: string) => ({
      select: () => new MockQuery(
        table === "qb_programs" ? programs : policies,
        workspaceId,
        table,
        observations,
      ),
    }),
  } as any;
}

const baseInput = {
  customerType: "standard" as const,
  brandId: "brand-asv",
  dealDate: "2026-04-15",
};

describe("validateStackingFromDB", () => {
  it("keeps zero or one verified program valid without inventing a pair rule", async () => {
    expect(await validateStackingFromDB({ ...baseInput, programIds: [] }, makeMock([], []))).toEqual({
      valid: true,
      validProgramIds: [],
      violations: [],
      warnings: [],
    });
    expect((await validateStackingFromDB(
      { ...baseInput, programIds: ["p1"] },
      makeMock([program("p1", "cash_in_lieu", "Cash")], []),
    )).valid).toBe(true);
  });

  it("uses the exact reviewed program pair instead of a global type-pair rule", async () => {
    const observations: QueryObservation[] = [];
    const programs = [
      program("p1", "cash_in_lieu", "ASV cash"),
      program("p2", "low_rate_financing", "ASV finance"),
    ];
    const result = await validateStackingFromDB(
      { ...baseInput, programIds: ["p1", "p2"] },
      makeMock(
        programs,
        [
          policy("p1", "p2", false),
          policy("other-1", "other-2", true),
        ],
        "default",
        observations,
      ),
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("Worksheet blocks");
    expect(result.validProgramIds).toEqual(["p1"]);
    expect(observations).toContainEqual({
      table: "qb_program_pair_policies",
      operation: "in",
      column: "program_a_id",
      value: ["p1", "p2"],
    });
    expect(observations).toContainEqual({
      table: "qb_program_pair_policies",
      operation: "in",
      column: "program_b_id",
      value: ["p1", "p2"],
    });
  });

  it("allows the same program types to differ by OEM", async () => {
    const programs = [
      program("a1", "cash_in_lieu", "ASV cash"),
      program("a2", "low_rate_financing", "ASV finance"),
      program("y1", "cash_in_lieu", "Yanmar cash", { brand_id: "brand-yanmar" }),
      program("y2", "low_rate_financing", "Yanmar finance", { brand_id: "brand-yanmar" }),
    ];
    const policies = [
      policy("a1", "a2", false),
      policy("y1", "y2", true, { brand_id: "brand-yanmar" }),
    ];

    const asv = await validateStackingFromDB(
      { ...baseInput, programIds: ["a1", "a2"] },
      makeMock(programs, policies),
    );
    const yanmar = await validateStackingFromDB(
      {
        ...baseInput,
        brandId: "brand-yanmar",
        programIds: ["y1", "y2"],
      },
      makeMock(programs, policies),
    );

    expect(asv.valid).toBe(false);
    expect(yanmar.valid).toBe(true);
  });

  it("resolves the policy effective on the quote date", async () => {
    const programs = [
      program("p1", "cash_in_lieu", "Cash"),
      program("p2", "aged_inventory", "Aged"),
    ];
    const policies = [
      policy("p1", "p2", false, {
        effective_from: "2026-01-01",
        effective_to: "2026-06-30",
        notes: "H1 blocks",
      }),
      policy("p1", "p2", true, {
        effective_from: "2026-07-01",
        effective_to: "2026-12-31",
        notes: "H2 permits",
      }),
    ];

    const h1 = await validateStackingFromDB(
      { ...baseInput, programIds: ["p1", "p2"], dealDate: "2026-06-30" },
      makeMock(programs, policies),
    );
    const h2 = await validateStackingFromDB(
      { ...baseInput, programIds: ["p1", "p2"], dealDate: "2026-07-01" },
      makeMock(programs, policies),
    );

    expect(h1.valid).toBe(false);
    expect(h2.valid).toBe(true);
  });

  it("fails closed when the worksheet-backed pair policy is absent", async () => {
    const programs = [
      program("p1", "cash_in_lieu", "Cash"),
      program("p2", "aged_inventory", "Aged"),
    ];
    const result = await validateStackingFromDB(
      { ...baseInput, programIds: ["p1", "p2"] },
      makeMock(programs, []),
    );

    expect(result.valid).toBe(false);
    expect(result.violations.join(" ")).toMatch(/policy pending.*customer send is blocked/i);
  });

  it("fails closed for an unverified or out-of-window program", async () => {
    const programs = [
      program("p1", "cash_in_lieu", "Cash", {
        stack_policy_provenance: "legacy_unverified",
      }),
      program("p2", "aged_inventory", "Aged"),
    ];
    const result = await validateStackingFromDB(
      { ...baseInput, programIds: ["p1", "p2"] },
      makeMock(programs, [policy("p1", "p2", true)]),
    );

    expect(result.valid).toBe(false);
    expect(result.validProgramIds).toEqual([]);
    expect(result.violations.join(" ")).toMatch(/worksheet review/i);
  });

  it("does not consume a policy from another workspace", async () => {
    const programs = [
      program("p1", "cash_in_lieu", "Cash"),
      program("p2", "aged_inventory", "Aged"),
    ];
    const foreignPolicy = policy("p1", "p2", true, { workspace_id: "foreign" });
    const result = await validateStackingFromDB(
      { ...baseInput, programIds: ["p1", "p2"] },
      makeMock(programs, [foreignPolicy], "default"),
    );

    expect(result.valid).toBe(false);
    expect(result.violations.join(" ")).toMatch(/policy pending/i);
  });
});
