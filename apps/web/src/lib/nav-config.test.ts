import { describe, expect, test } from "bun:test";

import {
  canAccessAccountModuleForIronRole,
  canAccessNavHrefForIronRole,
  canAccessPrimaryHeaderForIronRole,
  NAV_ITEMS,
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

describe("nav-config — WAVE phase 6 Sales dropdown wiring", () => {
  function salesItems(role: "rep" | "admin" | "manager" | "owner") {
    return NAV_ITEMS.filter(
      (item) =>
        item.primaryHeaderId === "sales" &&
        (item.roles ?? []).includes(role),
    );
  }

  test("rep Sales dropdown points at /sales/* surfaces only", () => {
    const hrefs = salesItems("rep").map((item) => item.href);
    expect(hrefs).toContain("/sales/today");
    expect(hrefs).toContain("/sales/pipeline");
    expect(hrefs).toContain("/sales/customers");
    expect(hrefs).toContain("/sales/quotes");
    expect(hrefs).toContain("/sales/field-note");
    expect(hrefs).toContain("/sales/voice-quote");
    expect(hrefs).toContain("/sales/my-mirror");
    for (const href of hrefs) {
      expect(href.startsWith("/sales/")).toBe(true);
    }
  });

  test("dashboard nav entry routes reps to /sales/today (mobile shell)", () => {
    const dashboard = salesItems("rep").find((item) => item.label === "Dashboard");
    expect(dashboard?.href).toBe("/sales/today");
  });

  test("organizes Sales dropdown into Workspace / Execution / Reflection sections", () => {
    const sections = new Set(
      salesItems("rep").map((item) => item.sectionLabel),
    );
    expect(sections.has("Workspace")).toBe(true);
    expect(sections.has("Execution")).toBe(true);
    expect(sections.has("Reflection")).toBe(true);
  });

  test("admin still sees the same /sales/* dropdown items", () => {
    const repHrefs = salesItems("rep").map((item) => item.href).sort();
    const adminHrefs = salesItems("admin").map((item) => item.href).sort();
    expect(adminHrefs).toEqual(repHrefs);
  });
});
