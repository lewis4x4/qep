import { describe, expect, it } from "bun:test";
import { hrefForGraphResult } from "../src/features/qrm/components/graphExplorerRoutes";
import type { QrmSearchItem } from "../src/features/qrm/lib/types";

function makeItem(
  overrides: Partial<QrmSearchItem> & Pick<QrmSearchItem, "type" | "id">,
): QrmSearchItem {
  return {
    title: "Test item",
    subtitle: null,
    updatedAt: "2026-04-20T00:00:00Z",
    rank: 0,
    ...overrides,
  };
}

describe("hrefForGraphResult", () => {
  it("routes contact to /qrm/contacts/:id", () => {
    expect(hrefForGraphResult(makeItem({ type: "contact", id: "c-1" })))
      .toBe("/qrm/contacts/c-1");
  });

  it("routes company to the account command center (Track 7A default drill-down)", () => {
    expect(hrefForGraphResult(makeItem({ type: "company", id: "co-1" })))
      .toBe("/qrm/accounts/co-1/command");
  });

  it("routes deal to /qrm/deals/:id", () => {
    expect(hrefForGraphResult(makeItem({ type: "deal", id: "d-1" })))
      .toBe("/qrm/deals/d-1");
  });

  it("routes equipment to inventory-pressure with equipment query param", () => {
    // Equipment has no dedicated list URL in shell v2 — the inventory-pressure
    // surface hosts it. Test the exact query param contract so the surface
    // can rely on it when deep-linked from search.
    expect(hrefForGraphResult(makeItem({ type: "equipment", id: "e-1" })))
      .toBe("/qrm/inventory-pressure?equipment=e-1");
  });

  it("routes rental to rentals with request query param", () => {
    expect(hrefForGraphResult(makeItem({ type: "rental", id: "r-1" })))
      .toBe("/qrm/rentals?request=r-1");
  });

  it("preserves the id verbatim (uuids with dashes, etc.)", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(hrefForGraphResult(makeItem({ type: "contact", id: uuid })))
      .toBe(`/qrm/contacts/${uuid}`);
  });
});
