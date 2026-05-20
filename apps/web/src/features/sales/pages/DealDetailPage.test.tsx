/**
 * WAVE phase 5 — DealDetailPage smoke test.
 *
 * Full rendering is integration-bound (useAuth + supabase + tanstack
 * query) and bun:test mock.module pollutes the
 * process-global module cache. Rendering tests live in the Phase 7
 * Playwright suite; this spec just asserts the page exports a function
 * component so import paths are guaranteed at build time.
 */

import { describe, expect, test } from "bun:test";
import { DealDetailPage, getDealDetailQuickLogSubject } from "./DealDetailPage";

describe("DealDetailPage — WAVE phase 5 surface", () => {
  test("routes deal detail quick logs to deal subject only", () => {
    expect(getDealDetailQuickLogSubject(undefined, "company-1")).toBeNull();
    expect(getDealDetailQuickLogSubject(null, "company-1")).toBeNull();
    expect(getDealDetailQuickLogSubject("deal-1", "company-1")).toEqual({
      dealId: "deal-1",
      companyId: "company-1",
    });
    expect(getDealDetailQuickLogSubject("deal-1")).toEqual({ dealId: "deal-1" });
  });

  test("exports a function component", () => {
    expect(typeof DealDetailPage).toBe("function");
    expect(DealDetailPage.name).toBe("DealDetailPage");
  });
});
