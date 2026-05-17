/**
 * WAVE polish (Slice 6) — OutcomeCaptureDrawer collapses to
 * MobileBottomSheet at <640px. Full rendering needs useAuth +
 * useToast + supabase + the outcomes-api, which is heavier than a
 * focused unit test should pull in — that path is covered by the
 * polish-wave Playwright walk. This spec just smoke-tests the export
 * shape so the import surface and TypeScript shape are guaranteed.
 */

import { describe, expect, test } from "bun:test";
import { OutcomeCaptureDrawer } from "../OutcomeCaptureDrawer";

describe("OutcomeCaptureDrawer — Slice 6 surface", () => {
  test("exports a function component", () => {
    expect(typeof OutcomeCaptureDrawer).toBe("function");
    expect(OutcomeCaptureDrawer.name).toBe("OutcomeCaptureDrawer");
  });
});
