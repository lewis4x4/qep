import { describe, expect, test } from "bun:test";
import { normalizePortalOrderLines, portalCartSummary } from "./portal-order-utils";

describe("portal-order-utils", () => {
  test("normalizes line items and drops blank part numbers", () => {
    expect(
      normalizePortalOrderLines([
        { part_number: " ABC-1 ", quantity: 2.7 },
        { part_number: " ", quantity: 10 },
      ]),
    ).toEqual([
      { part_number: "ABC-1", quantity: 2 },
    ]);
  });

  test("builds a cart summary from valid lines", () => {
    expect(
      portalCartSummary([
        { part_number: "ABC-1", quantity: 2 },
        { part_number: "XYZ-9", quantity: 4 },
      ]),
    ).toEqual({
      lineCount: 2,
      totalQuantity: 6,
    });
  });
});
