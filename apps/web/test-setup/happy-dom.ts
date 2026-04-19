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
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register({
    url: "http://localhost:5173",
    width: 1280,
    height: 900,
  });
}
