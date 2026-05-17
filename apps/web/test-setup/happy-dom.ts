/**
 * happy-dom preload for integration tests.
 *
 * Slice 08 CP6: establishes a minimal DOM environment so `.integration.test.tsx`
 * files can mount React components with @testing-library/react. Unit tests
 * (`.test.ts` / `.test.tsx`) that don't need the DOM are unaffected — they
 * either do nothing with `document` or run before this preload kicks in.
 *
 * Usage — in a test file:
 *   import { render, screen, fireEvent } from "@testing-library/react";
 *   render(<MyComponent />);
 *   expect(screen.getByText("Hello")).toBeTruthy();
 *
 * Configured in root bunfig.toml via [test].preload.
 *
 * WAVE CI/Quality (Slice 3): cross-file pollution hardening. Without
 * this block the full-suite sweep regresses on ~13 tests whose
 * symptoms point at shared DOM/storage state:
 *
 *   - DOMException: Failed to execute 'removeChild' on 'Node' (the
 *     previous test's React tree wasn't fully unmounted before the
 *     next test's cleanup ran).
 *   - getByText finds multiple elements (previous render leaked into
 *     document.body).
 *   - localStorage/sessionStorage from one feature's test bleeds into
 *     another feature's assertion (auth-recovery, supabase session
 *     mocks, etc.).
 *
 * The afterEach below resets browser storage, document body, and
 * cookies between tests so each test file starts with a clean DOM.
 * It's installed once at preload so individual files don't have to
 * remember it.
 */

import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Happy-dom MUST register before @testing-library/react is imported —
// the @testing-library/dom `screen` helper captures `document` at
// module-evaluation time, and a missing document at import time
// poisons every test that uses screen.* with "For queries bound to
// document.body a global document has to be available".
if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register({
    url: "http://localhost:5173",
    width: 1280,
    height: 900,
  });
}

// Global testing-library cleanup. Many of the older integration test
// files don't call afterEach(cleanup) themselves — installing it here
// at preload time guarantees every test file gets React-tree unmount
// between tests, which is what was causing the full-suite "Found
// multiple elements" / "removeChild" errors on the polish + deep-
// reflow wave ship reports.
// Loaded with a dynamic import so the static import order can't put
// @testing-library/react ahead of GlobalRegistrator.register().
const { cleanup } = await import("@testing-library/react");
afterEach(() => {
  cleanup();
});

afterEach(() => {
  // Reset browser storage so feature A's localStorage write doesn't
  // race feature B's read.
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  } catch {
    // happy-dom may not always expose Storage; ignore.
  }
  // Reset cookies (legacy auth tests sometimes set them).
  if (typeof document !== "undefined") {
    const cookieList = document.cookie ? document.cookie.split(";") : [];
    for (const cookie of cookieList) {
      const trimmed = cookie.replace(/^ +/, "").replace(/=.*/, "");
      if (trimmed) {
        document.cookie = `${trimmed}=;expires=${new Date(0).toUTCString()};path=/`;
      }
    }
  }
  // NOTE — intentionally NOT wiping document.body here. testing-
  // library's own cleanup() owns React-tree unmount; pre-emptively
  // emptying body can race React's commit phase and trigger a
  // "removeChild: Node not a child of this node" DOMException. Each
  // test file that mounts React already pairs render() with
  // afterEach(cleanup) from @testing-library/react.
});
