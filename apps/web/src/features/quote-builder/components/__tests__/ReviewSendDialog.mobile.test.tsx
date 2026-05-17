/**
 * WAVE polish (Slice 6) — ReviewSendDialog Dialog → MobileBottomSheet
 * at <640px. Full rendering needs a ReadinessRow + SendQuoteSection +
 * QuoteWorkspaceDraft fixture chain; the behavior is asserted by the
 * polish-wave Playwright walk. Smoke test only.
 */

import { describe, expect, test } from "bun:test";
import { ReviewSendDialog } from "../ReviewSendDialog";

describe("ReviewSendDialog — Slice 6 surface", () => {
  test("exports a function component", () => {
    expect(typeof ReviewSendDialog).toBe("function");
    expect(ReviewSendDialog.name).toBe("ReviewSendDialog");
  });
});
