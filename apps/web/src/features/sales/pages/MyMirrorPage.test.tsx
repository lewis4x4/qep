/**
 * WAVE phase 4 — MyMirrorPage smoke test.
 *
 * The page is heavily integration-bound (useAuth + supabase + tanstack
 * query), and bun:test's mock.module pollutes the process-global module
 * cache. Rather than render the page (which would force us to mock
 * supabase chains for the rest of the test run), this spec asserts the
 * static export shape. Page behavior is verified end-to-end by the
 * Phase 7 mobile-sales-rep Playwright suite.
 */

import { describe, expect, test } from "bun:test";
import { MyMirrorPage } from "./MyMirrorPage";

describe("MyMirrorPage — WAVE phase 4 surface", () => {
  test("exports a function component", () => {
    expect(typeof MyMirrorPage).toBe("function");
    expect(MyMirrorPage.name).toBe("MyMirrorPage");
  });
});
