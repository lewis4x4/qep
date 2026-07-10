import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../../..");
const readRepoFile = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Quote Builder route decomposition contract", () => {
  test("does not grandfather the Quote Builder route chunk", () => {
    const limits = JSON.parse(
      readRepoFile("apps/web/bundle-size-limits.json"),
    ) as { routeChunkMaxBytes: number; routeChunkExemptions: string[] };

    expect(limits.routeChunkMaxBytes).toBe(150_000);
    expect(
      limits.routeChunkExemptions.some((prefix) => prefix.startsWith("QuoteBuilderV2Page-")),
    ).toBe(false);
  });

  test("keeps device shells and wizard steps behind interaction boundaries", () => {
    const pageView = readRepoFile(
      "apps/web/src/features/quote-builder/components/QuoteBuilderV2PageView.tsx",
    );
    const stepRouter = readRepoFile(
      "apps/web/src/features/quote-builder/wizard/QuoteWizardStepRouter.tsx",
    );

    expect(pageView).toContain('import("./QuoteBuilderDesktopViewHost")');
    expect(pageView).toContain('import("./QuoteBuilderMobileViewHost")');
    expect(stepRouter).toContain('import("../steps/CustomerStep")');
    expect(stepRouter).toContain('import("../steps/ReviewStep")');
  });

  test("loads the printable proposal renderer only after PDF fallback", () => {
    const pdfHook = readRepoFile(
      "apps/web/src/features/quote-builder/hooks/useQuotePDF.ts",
    );

    expect(pdfHook).toContain('await import("../lib/quote-print-html")');
    expect(pdfHook).not.toMatch(/^import .*quote-print-html/m);
  });
});
