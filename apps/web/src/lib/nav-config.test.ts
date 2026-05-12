import { describe, expect, test } from "bun:test";

import {
  canAccessAccountModuleForIronRole,
  canAccessNavHrefForIronRole,
  canAccessPrimaryHeaderForIronRole,
  resolveActivePrimaryHeader,
  resolvePrimaryNavGroups,
  resolveUtilityNavSections,
} from "./nav-config";

describe("nav-config", () => {
  test("keeps voice quote under the Sales chrome", () => {
    expect(resolveActivePrimaryHeader("/voice-quote")).toBe("sales");
  });

  test("scopes iron_advisor away from parts/service/rentals menus", () => {
    const groups = resolvePrimaryNavGroups(false, false, "rep", "iron_advisor");
    const ids = groups.map((group) => group.id);
    expect(ids).toContain("sales");
    expect(ids).toContain("qrm");
    expect(ids).not.toContain("parts");
    expect(ids).not.toContain("service");
    expect(ids).not.toContain("rentals");
  });

  test("keeps iron_advisor utility to OS only", () => {
    const utility = resolveUtilityNavSections(false, false, "rep", "iron_advisor")
      .flatMap((section) => section.items)
      .map((item) => item.href);
    expect(utility).toEqual(["/os"]);
  });

  test("applies centralized persona policy to route/header checks", () => {
    expect(canAccessPrimaryHeaderForIronRole("iron_advisor", "parts")).toBe(false);
    expect(canAccessPrimaryHeaderForIronRole("iron_advisor", "service")).toBe(false);
    expect(canAccessPrimaryHeaderForIronRole("iron_advisor", "qrm")).toBe(true);
    expect(canAccessNavHrefForIronRole("iron_advisor", "/qrm/time-bank")).toBe(true);
    expect(canAccessNavHrefForIronRole("iron_advisor", "/qrm/parts-intelligence")).toBe(false);
    expect(canAccessAccountModuleForIronRole("iron_advisor", "command")).toBe(true);
    expect(canAccessAccountModuleForIronRole("iron_advisor", "relationship-map")).toBe(true);
    expect(canAccessAccountModuleForIronRole("iron_advisor", "strategist")).toBe(false);
  });
});
