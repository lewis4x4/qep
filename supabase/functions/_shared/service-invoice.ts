/** One transaction owns service invoice identity, classified lines and sync intent. */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function generateInvoiceForServiceJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ invoice_id: string | null; not_applicable?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("service_generate_invoice_atomic", { p_job_id: jobId });
  if (error) return { invoice_id: null, error: error.message };
  if (!data || typeof data !== "object") return { invoice_id: null, error: "Invoice transaction returned no result" };
  return { invoice_id: typeof data.invoice_id === "string" ? data.invoice_id : null, ...(data.not_applicable === true ? { not_applicable: true } : {}) };
}
