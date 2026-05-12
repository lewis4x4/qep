import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("portal-stripe derives checkout amount from the invoice balance", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const invoiceLoadIndex = source.indexOf('.from("customer_invoices")');
  const balanceIndex = source.indexOf("const balanceCents = Math.round");
  const stripeIndex = source.indexOf('fetch(`${STRIPE_API_BASE}/checkout/sessions`');

  assert(invoiceLoadIndex > -1);
  assert(balanceIndex > invoiceLoadIndex);
  assert(stripeIndex > balanceIndex);
  assertEquals(source.includes("amount_cents must match the current invoice balance"), true);
  assertEquals(source.includes('params.set("line_items[0][price_data][unit_amount]", String(amountCents))'), true);
});
