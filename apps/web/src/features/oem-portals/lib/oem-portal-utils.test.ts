import { describe, expect, test } from "bun:test";
import { countPortalSetupReady, matchesOemPortalFilters, sortOemPortals, type OemPortalRow } from "./oem-portal-utils";

const base: OemPortalRow = {
  id: "1",
  brand_code: "ASV",
  oem_name: "ASV",
  portal_name: "ASV Dealer Portal",
  segment: "construction",
  launch_url: "https://dealer.example.com",
  status: "active",
  access_mode: "bookmark_only",
  favorite: false,
  mfa_required: true,
  credential_owner: "Ops",
  support_contact: "ops@example.com",
  notes: "Shared branch login",
  sort_order: 10,
};

describe("oem-portal-utils", () => {
  test("matches text and select filters", () => {
    expect(matchesOemPortalFilters(base, { search: "ASV" })).toBe(true);
    expect(matchesOemPortalFilters(base, { segment: "construction" })).toBe(true);
    expect(matchesOemPortalFilters(base, { status: "active" })).toBe(true);
    expect(matchesOemPortalFilters(base, { accessMode: "bookmark_only" })).toBe(true);
    expect(matchesOemPortalFilters(base, { search: "yanmar" })).toBe(false);
  });

  test("sorts favorites first", () => {
    const rows = sortOemPortals([
      { ...base, id: "2", favorite: false, sort_order: 20, oem_name: "Yanmar" },
      { ...base, id: "3", favorite: true, sort_order: 30, oem_name: "Bandit" },
    ]);
    expect(rows[0]?.id).toBe("3");
  });

  test("counts only active portals with URLs as ready", () => {
    expect(countPortalSetupReady([
      base,
      { ...base, id: "2", launch_url: null },
      { ...base, id: "3", status: "needs_setup" },
    ])).toBe(1);
  });
});
