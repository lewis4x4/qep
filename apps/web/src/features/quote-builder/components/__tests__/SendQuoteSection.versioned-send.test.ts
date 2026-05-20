import { describe, expect, test } from "bun:test";

const componentPath = new URL("../SendQuoteSection.tsx", import.meta.url);
const quoteListPath = new URL("../../pages/QuoteListPage.tsx", import.meta.url);

describe("quote send bypass guards", () => {
  test("SendQuoteSection is callback-owned and does not call sendQuotePackage directly", async () => {
    const source = await Bun.file(componentPath).text();
    expect(source).not.toContain("sendQuotePackage");
    expect(source).toContain("onSendQuote");
    expect(source).toContain("fresh immutable PDF version");
  });

  test("quote-list quick resend is visibly disabled instead of calling sendQuotePackage", async () => {
    const source = await Bun.file(quoteListPath).text();
    expect(source).not.toContain("sendQuotePackage");
    expect(source).toContain("Resend disabled");
    expect(source).toContain("quick resend cannot bypass fresh immutable PDF generation");
  });
});
