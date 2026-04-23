import { describe, expect, test } from "bun:test";

import { buildCatalogQueryCandidates } from "../catalog-query-candidates";

describe("buildCatalogQueryCandidates", () => {
  test("returns empty for blank input", () => {
    expect(buildCatalogQueryCandidates("")).toEqual([]);
    expect(buildCatalogQueryCandidates("   ")).toEqual([]);
  });

  test('strips "(2026)" year token after the full query', () => {
    const candidates = buildCatalogQueryCandidates("Case SR175 (2026)");
    expect(candidates[0]).toBe("Case SR175 (2026)");
    expect(candidates).toContain("Case SR175");
  });

  test("strips a bare 4-digit year anywhere in the string", () => {
    const candidates = buildCatalogQueryCandidates("2024 Bobcat T770");
    expect(candidates).toContain("Bobcat T770");
  });

  test("includes make + model and make-only fallbacks", () => {
    const candidates = buildCatalogQueryCandidates("Case SR175 (2026)");
    expect(candidates).toContain("Case SR175");
    expect(candidates).toContain("Case");
  });

  test("dedupes candidates so we don't repeat searches", () => {
    const candidates = buildCatalogQueryCandidates("Case");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  test("drops candidates shorter than 2 chars", () => {
    const candidates = buildCatalogQueryCandidates("X SR175");
    expect(candidates.every((q) => q.length >= 2)).toBe(true);
  });

  test("preserves make+model when the AI label has no year", () => {
    const candidates = buildCatalogQueryCandidates("Caterpillar 232D3");
    expect(candidates).toContain("Caterpillar 232D3");
    expect(candidates).toContain("Caterpillar");
  });
});
