import { describe, expect, test } from "bun:test";

import { marginKeyFor } from "../useQuoteBuilderSave";

describe("marginKeyFor", () => {
  test("keys new quotes without an id", () => {
    expect(marginKeyFor(null, 12.34)).toBe("new|12.3");
  });

  test("keys saved quotes by id and rounded margin", () => {
    expect(marginKeyFor("pkg-1", 8.456)).toBe("pkg-1|8.5");
  });
});
