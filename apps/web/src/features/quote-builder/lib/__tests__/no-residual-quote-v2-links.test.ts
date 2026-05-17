/**
 * WAVE parity-close (Slice 4) — guard against future /quote-v2
 * regressions.
 *
 * The polish wave shipped buildQuoteBuilderHref + buildQuoteListHref
 * helpers in features/quote-builder/lib/quote-route.ts and the
 * parity-close wave swept the remaining inline /quote-v2 references.
 * This test walks every .ts / .tsx file under apps/web/src and fails
 * if a new /quote-v2 literal lands anywhere except:
 *
 *   - The RedirectPreserveSearch route mount in App.tsx (preserves
 *     inbound bookmarks from pre-SalesShell deep links). That line
 *     contains the literal "RedirectPreserveSearch" so we skip lines
 *     that match it.
 *   - This guard test itself.
 *   - Comments that document the legacy path *exhaustively explain*
 *     why we keep the redirect (currently zero of these — the wave
 *     rephrased every doc comment to drop the literal).
 *
 * New callsites that want to link into Quote Builder must use
 * buildQuoteBuilderHref / buildQuoteListHref from quote-route.ts.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, "..", "..", "..", "..");

// Files allowed to contain the literal /quote-v2 (the redirect mount).
const ALLOWED_FILES = new Set<string>([
  // resolved at runtime relative to SRC_ROOT
]);

function isAllowedLine(line: string): boolean {
  if (line.includes("RedirectPreserveSearch")) return true;
  if (line.includes("redirect-preserve")) return true;
  return false;
}

function isExcludedPath(path: string): boolean {
  if (path.includes("/__tests__/")) return true;
  if (/\.test\.tsx?$/.test(path)) return true;
  if (/\.spec\.tsx?$/.test(path)) return true;
  if (/\.d\.ts$/.test(path)) return true;
  return false;
}

describe("apps/web/src — no residual /quote-v2 inline links", () => {
  test("every /quote-v2 reference is on a RedirectPreserveSearch line", () => {
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const match of glob.scanSync({ cwd: SRC_ROOT, absolute: false })) {
      if (isExcludedPath(match)) continue;
      const abs = resolve(SRC_ROOT, match);
      if (ALLOWED_FILES.has(abs)) continue;
      let contents: string;
      try {
        contents = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (!contents.includes("/quote-v2")) continue;
      const lines = contents.split("\n");
      lines.forEach((line, idx) => {
        if (!line.includes("/quote-v2")) return;
        if (isAllowedLine(line)) return;
        offenders.push({ file: match, line: idx + 1, text: line.trim().slice(0, 200) });
      });
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
