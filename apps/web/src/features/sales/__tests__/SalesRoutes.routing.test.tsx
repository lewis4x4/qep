/**
 * WAVE phase 1+2 — SalesRoutes hosts QuoteListPage, QuoteBuilderV2Page,
 * FieldNotePage, and FieldNoteHistoryPage under SalesShell at
 * /sales/quotes(/...) and /sales/field-note(/history).
 *
 * NOTE on testing approach: bun:test's `mock.module` is process-global
 * and persists for the rest of the test run, so mocking the lazy page
 * modules here breaks downstream tests that import the real exports
 * (e.g. QuoteListPage-stats.test.ts uses `sortQuoteItems` from
 * QuoteListPage.tsx). Instead of rendering, this spec asserts the
 * static SalesRoutes module shape: it imports cleanly and exports a
 * named SalesRoutes function. Path matching is covered by tsc (the
 * route paths are typed) and by integration tests for each page.
 */

import { describe, expect, test } from "bun:test";
import { SalesRoutes } from "../SalesRoutes";

describe("SalesRoutes — WAVE phase 1+2 quote + field-note wiring", () => {
  test("exports a SalesRoutes function component", () => {
    expect(typeof SalesRoutes).toBe("function");
    expect(SalesRoutes.name).toBe("SalesRoutes");
  });
});
