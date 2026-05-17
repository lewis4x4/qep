import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  MOBILE_VIEWPORT_BREAKPOINT_PX,
  useIsMobileViewport,
} from "./useIsMobileViewport";

interface FakeMql {
  matches: boolean;
  listeners: Set<(event: { matches: boolean }) => void>;
  setMatches: (next: boolean) => void;
}

let activeMql: FakeMql | null = null;
const originalMatchMedia = window.matchMedia;

function installFakeMatchMedia(initialMatches: boolean): FakeMql {
  const mql: FakeMql = {
    matches: initialMatches,
    listeners: new Set(),
    setMatches(next) {
      mql.matches = next;
      for (const listener of mql.listeners) {
        listener({ matches: next });
      }
    },
  };
  activeMql = mql;
  // Cast through unknown so we can stub the read-only matchMedia for tests.
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
    query: string,
  ) => {
    return {
      matches: mql.matches,
      media: query,
      onchange: null,
      addEventListener: (_event: string, cb: (event: { matches: boolean }) => void) => {
        mql.listeners.add(cb);
      },
      removeEventListener: (
        _event: string,
        cb: (event: { matches: boolean }) => void,
      ) => {
        mql.listeners.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return mql;
}

beforeEach(() => {
  activeMql = null;
});

afterEach(() => {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMatchMedia;
  cleanup();
});

describe("useIsMobileViewport", () => {
  test("locks the breakpoint constant at 640", () => {
    expect(MOBILE_VIEWPORT_BREAKPOINT_PX).toBe(640);
  });

  test("returns true when matchMedia matches the mobile query", () => {
    installFakeMatchMedia(true);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(true);
  });

  test("returns false when matchMedia reports a non-mobile viewport", () => {
    installFakeMatchMedia(false);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);
  });

  test("re-renders when the media-query state flips", () => {
    const mql = installFakeMatchMedia(false);
    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);
    act(() => {
      mql.setMatches(true);
    });
    expect(result.current).toBe(true);
  });

  test("queries the breakpoint as max-width: 639px", () => {
    installFakeMatchMedia(true);
    let observedQuery: string | null = null;
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
      query: string,
    ) => {
      observedQuery = query;
      return {
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    renderHook(() => useIsMobileViewport());
    expect(observedQuery).toBe("(max-width: 639px)");
  });
});
