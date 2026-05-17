import { describe, expect, test } from "bun:test";

import { loadedQuotePackageId } from "../useExistingQuoteLoad";

describe("loadedQuotePackageId", () => {
  test("returns string id when present", () => {
    expect(loadedQuotePackageId({ id: "pkg-abc" })).toBe("pkg-abc");
  });

  test("returns null for missing or empty id", () => {
    expect(loadedQuotePackageId({})).toBeNull();
    expect(loadedQuotePackageId({ id: "" })).toBeNull();
    expect(loadedQuotePackageId({ id: 42 })).toBeNull();
  });
});
