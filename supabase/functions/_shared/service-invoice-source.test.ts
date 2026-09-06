import { generateInvoiceForServiceJob } from "./service-invoice.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
Deno.test("invoice generation delegates the whole operation to the atomic RPC", async () => {
  let calls = 0;
  const db = { rpc(name: string, args: Record<string, unknown>) {
    calls++;
    if (name !== "service_generate_invoice_atomic" || args.p_job_id !== "job-1") throw new Error("wrong boundary");
    return Promise.resolve({ data: { invoice_id: "invoice-1" }, error: null });
  } } as unknown as SupabaseClient;
  const result = await generateInvoiceForServiceJob(db, "job-1");
  if (calls !== 1 || result.invoice_id !== "invoice-1") throw new Error("atomic result missing");
});
Deno.test("invoice transaction failure remains a failure, never a saved header", async () => {
  const db = { rpc: () => Promise.resolve({ data: null, error: { message: "line insert rolled back" } }) } as unknown as SupabaseClient;
  const result = await generateInvoiceForServiceJob(db, "job-1");
  if (result.invoice_id !== null || result.error !== "line insert rolled back") throw new Error("failure was hidden");
});
Deno.test("internal no-invoice result is explicit without false failure", async () => {
  const db = { rpc: () => Promise.resolve({ data: { invoice_id: null, not_applicable: true }, error: null }) } as unknown as SupabaseClient;
  const result = await generateInvoiceForServiceJob(db, "job-1");
  if (result.invoice_id !== null || result.error) throw new Error("not applicable result lost");
});
