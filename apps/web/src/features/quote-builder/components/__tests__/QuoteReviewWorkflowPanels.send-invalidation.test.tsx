import { describe, expect, test } from "bun:test";

const panelPath = new URL("../QuoteReviewWorkflowPanels.tsx", import.meta.url);

describe("QuoteReviewWorkflowPanels send wiring", () => {
  test("wires SendQuoteSection onSent to sent-status change plus version-history invalidation", async () => {
    const source = await Bun.file(panelPath).text();

    expect(source).toContain("onSent={() => {");
    expect(source).toContain("onQuoteStatusChange(\"sent\")");
    expect(source).toContain("invalidateQueries({ queryKey: [\"quote-builder\", \"quote-pdf-versions\", quotePackageId] })");
  });
});
