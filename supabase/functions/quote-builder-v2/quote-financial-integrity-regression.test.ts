import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("quote save persists server-computed financial metrics, not request totals", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function computeQuoteFinancials("));
  assert(source.includes("const financials = provisionalArtifacts.computedMetrics"));
  for (const forbidden of [
    "equipment_total: body.equipment_total || 0",
    "attachment_total: body.attachment_total || 0",
    "subtotal: body.subtotal || 0",
    "discount_total: body.discount_total || 0",
    "net_total: body.net_total || 0",
    "amount_financed: body.amount_financed || 0",
    "margin_amount: body.margin_amount",
    "margin_pct: body.margin_pct",
  ]) {
    assertEquals(source.includes(forbidden), false, forbidden);
  }
});

Deno.test("quote version snapshots use computed financial metrics for approval routing", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const artifactsIndex = source.indexOf("function buildQuoteVersionArtifacts(");
  const financialsIndex = source.indexOf("const financials = computeQuoteFinancials(input.body)", artifactsIndex);
  const marginIndex = source.indexOf("marginPct: financials.margin_pct", financialsIndex);
  const amountIndex = source.indexOf("amount: financials.net_total", financialsIndex);
  assert(artifactsIndex > -1);
  assert(financialsIndex > artifactsIndex);
  assert(marginIndex > financialsIndex);
  assert(amountIndex > financialsIndex);
});

Deno.test("legacy misc credit rows are normalized before server financial totals", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes("function isMiscCreditLine("));
  assert(source.includes('lineString(metadata.misc_line_kind, 40) === "credit"'));
  assert(source.includes('|| isMiscCreditLine(line)'));
});
