import { describe, expect, test } from "bun:test";

import {
  marginKeyFor,
  requiresLowMarginDraftReason,
  resolveActiveQuotePackageId,
} from "../useQuoteBuilderSave";

describe("marginKeyFor", () => {
  test("keys new quotes without an id", () => {
    expect(marginKeyFor(null, 12.34)).toBe("new|12.3");
  });

  test("keys saved quotes by id and rounded margin", () => {
    expect(marginKeyFor("pkg-1", 8.456)).toBe("pkg-1|8.5");
  });
});

describe("requiresLowMarginDraftReason", () => {
  test("requires a reason when margin is below floor and current key is uncaptured", () => {
    expect(requiresLowMarginDraftReason({
      quoteId: "pkg-1",
      marginPct: 8.9,
      marginFloorPct: 10,
      capturedKey: null,
    })).toBe(true);
  });

  test("does not require a reason when current low-margin key is captured", () => {
    expect(requiresLowMarginDraftReason({
      quoteId: "pkg-1",
      marginPct: 8.94,
      marginFloorPct: 10,
      capturedKey: marginKeyFor("pkg-1", 8.94),
    })).toBe(false);
  });

  test("requires a fresh reason when the saved quote id changes from the new-quote key", () => {
    expect(requiresLowMarginDraftReason({
      quoteId: "pkg-1",
      marginPct: 8.9,
      marginFloorPct: 10,
      capturedKey: marginKeyFor(null, 8.9),
    })).toBe(true);
  });

  test("does not require a reason at or above floor", () => {
    expect(requiresLowMarginDraftReason({
      quoteId: "pkg-1",
      marginPct: 10,
      marginFloorPct: 10,
      capturedKey: null,
    })).toBe(false);
  });

  test("does not require a reason when no floor applies", () => {
    expect(requiresLowMarginDraftReason({
      quoteId: "pkg-1",
      marginPct: 5,
      marginFloorPct: null,
      capturedKey: null,
    })).toBe(false);
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
