import { describe, expect, test } from "bun:test";

import { marginKeyFor, resolveActiveQuotePackageId } from "../useQuoteBuilderSave";

describe("marginKeyFor", () => {
  test("keys new quotes without an id", () => {
    expect(marginKeyFor(null, 12.34)).toBe("new|12.3");
  });

  test("keys saved quotes by id and rounded margin", () => {
    expect(marginKeyFor("pkg-1", 8.456)).toBe("pkg-1|8.5");
  });
});

describe("resolveActiveQuotePackageId", () => {
  test("prefers save response over url and persisted", () => {
    expect(resolveActiveQuotePackageId({
      savedQuoteId: "saved-1",
      urlPackageId: "url-1",
      persistedId: "ref-1",
    })).toBe("saved-1");
  });

  test("uses loaded quote id before url", () => {
    expect(resolveActiveQuotePackageId({
      existingQuoteId: "loaded-1",
      urlPackageId: "url-1",
    })).toBe("loaded-1");
  });

  test("falls back to url package id for deep-linked edits", () => {
    expect(resolveActiveQuotePackageId({
      urlPackageId: "url-1",
      persistedId: "ref-1",
    })).toBe("url-1");
  });
});
