import { useSyncExternalStore } from "react";

export const HANDHELD_VIEWPORT_BREAKPOINT_PX = 1024;

function handheldMediaQuery(): string {
  return `(max-width: ${HANDHELD_VIEWPORT_BREAKPOINT_PX - 1}px)`;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(handheldMediaQuery());
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(handheldMediaQuery()).matches;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useIsHandheldViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
