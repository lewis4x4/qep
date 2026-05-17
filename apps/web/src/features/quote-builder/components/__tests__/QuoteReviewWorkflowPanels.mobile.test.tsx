/**
 * WAVE polish (Slice 4) — QuoteReviewWorkflowPanels now renders the
 * Approval Case as a tap-to-drill summary card on phone, opening a
 * MobileBottomSheet for the full evaluation + decision detail. This
 * spec just smoke-tests the export shape; rendering the panel needs a
 * QueryClient, a real approval-case payload, and a portal-revision
 * fixture — that surface is covered by the polish-wave Playwright
 * walk (apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts).
 *
 * The branching logic (mobile summary vs desktop inline card) is
 * already typecheck-verified by tsc + caught by the e2e
 * [role="dialog"]:not([data-mobile-sheet]) assertion.
 */

import { describe, expect, test } from "bun:test";
import { QuoteReviewWorkflowPanels } from "../QuoteReviewWorkflowPanels";

describe("QuoteReviewWorkflowPanels — Slice 4 surface", () => {
  test("exports a function component", () => {
    expect(typeof QuoteReviewWorkflowPanels).toBe("function");
    expect(QuoteReviewWorkflowPanels.name).toBe("QuoteReviewWorkflowPanels");
  });
});
