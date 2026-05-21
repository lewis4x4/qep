import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseYcenaPriceBookText } from "../ycena-price-book-parser.mjs";
import { buildYcenaSampleImportPlan } from "../ycena-sample-import.mjs";

const fixture = readFileSync(new URL("../__fixtures__/ycena-tl25rp-sample.txt", import.meta.url), "utf8");

describe("ycena sample import plan", () => {
  test("maps parsed YCENA rows to brand-prefixed base and option upserts", () => {
    const parsed = {
      ...parseYcenaPriceBookText(fixture, { brand: "Yanmar", dealerDiscountOffListPct: 30 }),
      sourceFilename: "Yanmar-CE-Price-Book-EFF-14APR2026_v2.pdf",
      sourceSha256: "sha",
    };

    const plan = buildYcenaSampleImportPlan(parsed, { brand: "Yanmar", workspaceId: "default" });

    expect(plan.summary).toMatchObject({
      parsedRows: 5,
      parsedBaseRows: 2,
      parsedOptionRows: 3,
      baseUpserts: 2,
      optionAssociations: 6,
      rowsSkipped: 0,
      modelCount: 1,
      models: ["TL25RP"],
    });

    expect(plan.baseUpserts[0]).toMatchObject({
      workspace_id: "default",
      base_number: "yanmar:4004-227",
      make: "Yanmar",
      model: "TL25RP",
      group_code: "Compact Track Loader",
      class_code: "base",
      price_cents: 5659800,
      cost_cents: 3961860,
      added_at: "2026-04-15",
      modified_at: "2026-04-14",
    });

    expect(plan.optionUpserts[0]).toMatchObject({
      workspace_id: "default",
      canonical_base_number: "yanmar:4004-227",
      option_number: "yanmar:2015-598",
      description: "Special Applications 1/4 inch polycarbonate front door with wiper",
      price_cents: 110500,
      cost_cents: 77350,
      master_price_cents: 110500,
      master_cost_cents: 77350,
    });

    expect(plan.optionUpserts.map((row) => row.canonical_base_number)).toEqual([
      "yanmar:4004-227",
      "yanmar:4004-228",
      "yanmar:4004-227",
      "yanmar:4004-228",
      "yanmar:4004-227",
      "yanmar:4004-228",
    ]);
  });

  test("deduplicates repeated option rows per base and records skipped transform rows", () => {
    const repeated = `${fixture}\n2015-598 Special Applications 1/4 inch polycarbonate front door with wiper $1,105`;
    const parsed = {
      ...parseYcenaPriceBookText(repeated, { brand: "Yanmar", dealerDiscountOffListPct: 30 }),
      sourceFilename: "Yanmar.pdf",
      sourceSha256: "sha",
    };

    const plan = buildYcenaSampleImportPlan(parsed, { brand: "Yanmar", workspaceId: "default" });

    expect(plan.summary.optionAssociations).toBe(6);
    expect(plan.summary.rowsSkipped).toBe(2);
    expect(plan.skipped.transform).toEqual([
      { baseNumber: "yanmar:4004-227", optionNumber: "yanmar:2015-598", model: "TL25RP", reason: "duplicate_option_for_base" },
      { baseNumber: "yanmar:4004-228", optionNumber: "yanmar:2015-598", model: "TL25RP", reason: "duplicate_option_for_base" },
    ]);
  });
});
