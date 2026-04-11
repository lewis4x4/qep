import { describe, expect, test } from "bun:test";
import {
  buildEmbeddedExecutivePreviewHref,
  canAccessExecutiveDepartmentDeck,
} from "./department-view-deck";

describe("department view deck", () => {
  test("limits preview access to admin and owner roles", () => {
    expect(canAccessExecutiveDepartmentDeck("admin")).toBe(true);
    expect(canAccessExecutiveDepartmentDeck("owner")).toBe(true);
    expect(canAccessExecutiveDepartmentDeck("manager")).toBe(false);
    expect(canAccessExecutiveDepartmentDeck("rep")).toBe(false);
  });

  test("appends embedded preview params to plain routes", () => {
    expect(buildEmbeddedExecutivePreviewHref("/service")).toBe(
      "/service?embedded=1&executive-preview=1",
    );
  });

  test("appends embedded preview params to routes with existing search params", () => {
    expect(buildEmbeddedExecutivePreviewHref("/service?job=123")).toBe(
      "/service?job=123&embedded=1&executive-preview=1",
    );
  });
});
