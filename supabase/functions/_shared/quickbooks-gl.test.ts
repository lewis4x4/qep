import { assertEquals } from "jsr:@std/assert@1";
import { buildQuickBooksJournalEntry, type QuickBooksCredentials } from "./quickbooks-gl.ts";

const credentials: QuickBooksCredentials = {
  client_id: "client",
  client_secret: "secret",
  refresh_token: "refresh",
  realm_id: "realm",
  environment: "sandbox",
  ar_account_id: "100",
  service_revenue_account_id: "200",
  parts_revenue_account_id: "201",
  haul_revenue_account_id: "202",
  shop_supplies_account_id: "203",
  misc_revenue_account_id: "299",
  tax_liability_account_id: "300",
};

Deno.test("buildQuickBooksJournalEntry creates debit and categorized credit lines", () => {
  const payload = buildQuickBooksJournalEntry(
    {
      id: "inv-1",
      invoice_number: "INV-1",
      invoice_date: "2026-04-22",
      total: 325,
      tax: 25,
      description: "Service invoice",
      service_job_id: "job-1",
      crm_company_id: "cust-1",
      company_name: "Evergreen Farms",
      line_items: [
        { id: "1", description: "Service Labor", quantity: 1, unit_price: 200, line_total: 200 },
        { id: "2", description: "ABC-1 — Filter kit", quantity: 1, unit_price: 100, line_total: 100 },
      ],
    },
    credentials,
  );

  const lines = (payload.Line as Array<Record<string, unknown>>);
  assertEquals(lines.length, 4);
  assertEquals((lines[0].JournalEntryLineDetail as { AccountRef: { value: string } }).AccountRef.value, "100");
  assertEquals((lines[1].JournalEntryLineDetail as { AccountRef: { value: string } }).AccountRef.value, "200");
  assertEquals((lines[2].JournalEntryLineDetail as { AccountRef: { value: string } }).AccountRef.value, "201");
  assertEquals((lines[3].JournalEntryLineDetail as { AccountRef: { value: string } }).AccountRef.value, "300");
});
