import { describe, expect, test } from "bun:test";

import { draftAutosaveImmediateState } from "../useDraftAutosave";

describe("draftAutosaveImmediateState", () => {
  test("does nothing while autosave is disabled", () => {
    expect(draftAutosaveImmediateState({
      enabled: false,
      draftReady: true,
      draftIsEmpty: false,
      pauseReason: "low_margin_reason_required",
    })).toBeNull();
  });

  test("keeps incomplete empty drafts idle", () => {
    expect(draftAutosaveImmediateState({
      enabled: true,
      draftReady: false,
      draftIsEmpty: true,
    })).toBe("idle");
  });

  test("marks incomplete non-empty drafts local", () => {
    expect(draftAutosaveImmediateState({
      enabled: true,
      draftReady: false,
      draftIsEmpty: false,
    })).toBe("local");
  });

  test("pauses ready low-margin drafts as local without scheduling save", () => {
    expect(draftAutosaveImmediateState({
      enabled: true,
      draftReady: true,
      draftIsEmpty: false,
      pauseReason: "low_margin_reason_required",
    })).toBe("local");
  });

  test("lets ready unpaused drafts continue to debounce scheduling", () => {
    expect(draftAutosaveImmediateState({
      enabled: true,
      draftReady: true,
      draftIsEmpty: false,
      pauseReason: null,
    })).toBeNull();
  });
});
