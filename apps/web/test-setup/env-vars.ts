/**
 * Test env-var preload.
 *
 * `apps/web/src/lib/supabase.ts` reads `import.meta.env.VITE_SUPABASE_URL`
 * and `VITE_SUPABASE_ANON_KEY` at module-load time and throws if either is
 * missing. In Vite dev/build those values come from .env files; in
 * `bun test` they're never injected, so any test file that imports
 * `@/lib/supabase` (directly or transitively via a component import)
 * crashes on first load.
 *
 * This preload sets safe test values on `process.env` before any module
 * loads. Bun surfaces `process.env` through `import.meta.env`, so the
 * supabase module sees both reads as non-empty strings and proceeds.
 *
 * The values are intentionally obvious fakes — no real Supabase URL, no
 * real anon key. Tests that actually need to talk to Supabase must mock
 * the client via `mock.module("@/lib/supabase", ...)` (see
 * `price-sheets-api.test.ts` and `PriceSheetsPage.integration.test.tsx`).
 *
 * Configured in root bunfig.toml and apps/web/bunfig.toml via [test].preload.
 */

// Use `??=` so a real env var set by CI or the developer still wins.
process.env.VITE_SUPABASE_URL ??= "http://test-supabase.local";
process.env.VITE_SUPABASE_ANON_KEY ??= "test-anon-key-not-real";

// Also populate import.meta.env directly in case Bun snapshots it
// separately from process.env. Wrapped in try/catch because some runtimes
// expose import.meta.env as a frozen object; if that's the case the
// process.env write above is the source of truth and we can ignore this.
try {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  if (meta.env && typeof meta.env === "object") {
    meta.env.VITE_SUPABASE_URL ??= process.env.VITE_SUPABASE_URL;
    meta.env.VITE_SUPABASE_ANON_KEY ??= process.env.VITE_SUPABASE_ANON_KEY;
  }
} catch {
  // import.meta.env is read-only in this runtime; process.env already has
  // the values set above, which is what Bun's import.meta.env reads from.
}
