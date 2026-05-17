/**
 * WAVE quote-builder deep reflow (Slice 0).
 *
 * Returns true when the viewport is below the mobile breakpoint (640px,
 * i.e. tailwind's `sm`). Used inside Quote Builder steps to gate
 * Dialog/AlertDialog → MobileBottomSheet swaps and any other layout
 * decisions that need to be runtime-reactive (orientation changes,
 * window resizes, side panels collapsing).
 *
 * SSR-safe: defaults to `true` (mobile-first) when `window` is
 * unavailable, matching the rest of the SalesShell rendering contract.
 */

import { useSyncExternalStore } from "react";

export const MOBILE_VIEWPORT_BREAKPOINT_PX = 640;

function mobileMediaQuery(): string {
  return `(max-width: ${MOBILE_VIEWPORT_BREAKPOINT_PX - 1}px)`;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(mobileMediaQuery());
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(mobileMediaQuery()).matches;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
