import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYcenaPriceBookFile, parseYcenaPriceBookText } from "../ycena-price-book-parser.mjs";

const fixture = readFileSync(new URL("../__fixtures__/ycena-tl25rp-sample.txt", import.meta.url), "utf8");

describe("ycena price book parser", () => {
  test("maps YCENA base and option rows with 30 percent dealer cost", () => {
    const parsed = parseYcenaPriceBookText(fixture, { brand: "Yanmar", dealerDiscountOffListPct: 30 });

    expect(parsed.parentOem).toBe("YCENA");
    expect(parsed.effectiveDate).toBe("2026-04-15");
    expect(parsed.summary).toMatchObject({
      rowCount: 5,
      baseRowCount: 2,
      optionRowCount: 3,
      modelCount: 1,
      models: ["TL25RP"],
    });

    expect(parsed.rows[0]).toMatchObject({
      brand: "Yanmar",
      parentOem: "YCENA",
      model: "TL25RP",
      category: "Compact Track Loader",
      partNumber: "4004-227",
      description: "Open ROPS Base",
      targetTable: "equipment_base_codes",
      listPriceCents: 5659800,
      dealerCostCents: 3961860,
    });

    expect(parsed.rows.at(-1)).toMatchObject({
      partNumber: "0405-229",
      targetTable: "equipment_options",
      listPriceCents: 463000,
      dealerCostCents: 324100,
    });
  });

  test("reports unclassified part rows in skipped output", () => {
    const parsed = parseYcenaPriceBookText(`${fixture}\n2015-951 This row is missing price`, { brand: "Yanmar" });

    expect(parsed.summary.skippedRowCount).toBe(1);
    expect(parsed.skipped[0]).toMatchObject({ reason: "unclassified_part_row" });
  });

  test("throws on empty extracted text", () => {
    expect(() => parseYcenaPriceBookText("   ")).toThrow("Source text is empty");
  });

  test("rejects unsupported source extension in file parser", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ycena-parser-"));
    const badPath = join(tempDir, "input.csv");
    writeFileSync(badPath, "part,price\n", "utf8");

    expect(() => parseYcenaPriceBookFile(badPath)).toThrow("Unsupported source extension");

    rmSync(tempDir, { recursive: true, force: true });
  });
});
