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
import { DealDetailPage } from "./DealDetailPage";

describe("DealDetailPage — WAVE phase 5 surface", () => {
  test("exports a function component", () => {
    expect(typeof DealDetailPage).toBe("function");
    expect(DealDetailPage.name).toBe("DealDetailPage");
  });
});
