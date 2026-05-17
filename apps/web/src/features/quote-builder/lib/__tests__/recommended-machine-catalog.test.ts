import { describe, expect, mock, test } from "bun:test";

import { findRecommendedCatalogMatch } from "../recommended-machine-catalog";
import type { CatalogEntryMatch } from "../quote-builder-page-helpers";

describe("findRecommendedCatalogMatch", () => {
  test("returns exact make/model match when present", async () => {
    const searchCatalog = mock(async (): Promise<CatalogEntryMatch[]> => ([
      { make: "Case", model: "SR175", year: 2026 },
      { make: "Case", model: "SV340", year: 2025 },
    ]));
    const match = await findRecommendedCatalogMatch("Case SR175 (2026)", searchCatalog);
    expect(match?.model).toBe("SR175");
  });

  test("falls back to first result when no exact label match", async () => {
    const searchCatalog = mock(async (): Promise<CatalogEntryMatch[]> => ([
      { make: "Case", model: "SR175B", year: 2026 },
    ]));
    const match = await findRecommendedCatalogMatch("Case SR175", searchCatalog);
    expect(match?.model).toBe("SR175B");
  });

  test("returns undefined when catalog has no matches", async () => {
    const searchCatalog = mock(async (): Promise<CatalogEntryMatch[]> => ([]));
    const match = await findRecommendedCatalogMatch("Unknown M999", searchCatalog);
    expect(match).toBeUndefined();
  });
});
