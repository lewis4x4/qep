/**
 * WAVE polish (Slice 3) — TradeCaptureDialog now renders as a
 * MobileBottomSheet on phone viewports and keeps the desktop Radix
 * Dialog at sm+. This spec drives both branches behind a stubbed
 * matchMedia.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { TradeCaptureDialog } from "../TradeCaptureDialog";
import type { TradeCaptureDraft, TradeChecklistKey } from "../../lib/trade-checklist";

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(matches: boolean): void {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
    query: string,
  ) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    originalMatchMedia;
  cleanup();
});

beforeEach(() => {
  stubMatchMedia(false);
});

function buildTradeCapture(): TradeCaptureDraft {
  return {
    hourMeter: "",
    serialPlate: "",
    payoffStatus: "",
    photo: "",
    workOrderHistory: "",
  };
}

function buildChecklist(): Record<TradeChecklistKey, boolean> {
  return {
    hourMeter: false,
    serialPlate: false,
    payoffStatus: false,
    photo: false,
    workOrderHistory: false,
  };
}

const COMMON_PROPS = {
  open: true,
  onOpenChange: () => {},
  activeTradeCaptureKey: "hourMeter" as TradeChecklistKey,
  onActiveTradeCaptureKeyChange: () => {},
  tradeCapture: buildTradeCapture(),
  setTradeCapture: () => {},
  tradeChecklist: buildChecklist(),
};

describe("TradeCaptureDialog mobile sheet conversion", () => {
  test("renders inside MobileBottomSheet at mobile viewport", () => {
    stubMatchMedia(true);
    render(<TradeCaptureDialog {...COMMON_PROPS} />);
    const panel = screen.getByTestId("mobile-bottom-sheet-panel");
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("data-mobile-sheet")).toBe("true");
  });

  test("renders inside Radix Dialog at desktop viewport", () => {
    stubMatchMedia(false);
    render(<TradeCaptureDialog {...COMMON_PROPS} />);
    expect(screen.queryByTestId("mobile-bottom-sheet-panel")).toBeNull();
    // Radix Dialog stamps role="dialog" without data-mobile-sheet
    const dialogs = document.querySelectorAll("[role=\"dialog\"]:not([data-mobile-sheet])");
    expect(dialogs.length).toBeGreaterThan(0);
  });

  test("preserves the active capture field on both viewports", () => {
    stubMatchMedia(true);
    const { unmount } = render(<TradeCaptureDialog {...COMMON_PROPS} />);
    expect(screen.getByPlaceholderText(/.+/i)).toBeTruthy();
    unmount();

    stubMatchMedia(false);
    render(<TradeCaptureDialog {...COMMON_PROPS} />);
    expect(screen.getByPlaceholderText(/.+/i)).toBeTruthy();
  });
});
