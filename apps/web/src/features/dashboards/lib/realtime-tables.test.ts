import { describe, expect, test } from "bun:test";
import { channelNameForRole, tablesForIronRole } from "./realtime-tables";

describe("tablesForIronRole", () => {
  test("iron_manager covers pipeline + approvals + aging sources", () => {
    const tables = tablesForIronRole("iron_manager");
    expect(tables).toContain("crm_deals");
    expect(tables).toContain("prospecting_kpis");
    expect(tables).toContain("demos");
    expect(tables).toContain("trade_valuations");
    expect(tables).toContain("crm_equipment");
    expect(tables).toContain("manufacturer_incentives");
    expect(tables).toContain("qrm_predictions");
  });

  test("iron_advisor is narrow — own deals + touchpoints + kpis", () => {
    const tables = tablesForIronRole("iron_advisor");
    expect(tables).toEqual([
      "crm_deals",
      "follow_up_touchpoints",
      "prospecting_kpis",
    ]);
  });

  test("iron_woman covers order processing surface", () => {
    const tables = tablesForIronRole("iron_woman");
    expect(tables).toEqual([
      "crm_deals",
      "deposits",
      "equipment_intake",
    ]);
  });

  test("iron_man covers prep / demo / returns", () => {
    const tables = tablesForIronRole("iron_man");
    expect(tables).toEqual([
      "equipment_intake",
      "demos",
      "rental_returns",
    ]);
  });

  test("no role returns an empty array (every role has at least one table)", () => {
    const roles = ["iron_manager", "iron_advisor", "iron_woman", "iron_man"] as const;
    for (const role of roles) {
      expect(tablesForIronRole(role).length).toBeGreaterThan(0);
    }
  });
});

describe("channelNameForRole", () => {
  test("builds stable name", () => {
    expect(channelNameForRole("iron_manager")).toBe("dashboard:iron_manager");
  });

  test("suffix appends for user-scoped channels", () => {
    expect(channelNameForRole("iron_advisor", "user-abc")).toBe("dashboard:iron_advisor:user-abc");
  });

  test("null suffix is ignored", () => {
    expect(channelNameForRole("iron_woman", null)).toBe("dashboard:iron_woman");
  });
});
