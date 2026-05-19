import { describe, expect, test } from "bun:test";
import { buildAccountDetailMenuItems } from "./account-detail-menu";

describe("buildAccountDetailMenuItems", () => {
  test("builds the canonical account detail menu in order", () => {
    const items = buildAccountDetailMenuItems("co-1");

    expect(items.map((item) => item.key)).toEqual([
      "legacy",
      "voice-note",
      "timeline",
      "genome",
      "operating-profile",
      "fleet-intelligence",
      "relationship-map",
      "white-space",
      "rental-conversion",
      "strategist",
      "fleet-radar",
      "duplicates",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "Legacy detail",
      "Record voice note",
      "Timeline",
      "Customer Genome",
      "Operating Profile",
      "Fleet Intelligence",
      "Relationship Map",
      "White-Space Map",
      "Rental Conversion",
      "AI Strategist",
      "Fleet Radar",
      "Review Duplicates",
    ]);
    expect(items.map((item) => item.href)).toEqual([
      "/qrm/companies/co-1",
      "/voice-qrm?linked_company_id=co-1",
      "/qrm/accounts/co-1/timeline",
      "/qrm/accounts/co-1/genome",
      "/qrm/accounts/co-1/operating-profile",
      "/qrm/accounts/co-1/fleet-intelligence",
      "/qrm/accounts/co-1/relationship-map",
      "/qrm/accounts/co-1/white-space",
      "/qrm/accounts/co-1/rental-conversion",
      "/qrm/accounts/co-1/strategist",
      "/qrm/companies/co-1/fleet-radar",
      "/admin/duplicates?accountId=co-1",
    ]);
  });
});
