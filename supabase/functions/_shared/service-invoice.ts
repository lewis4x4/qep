/**
 * Generate a customer_invoices row from an approved service quote (best-effort).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function generateInvoiceForServiceJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ invoice_id: string | null; error?: string }> {
  const { data: job, error: jErr } = await supabase
    .from("service_jobs")
    .select("id, workspace_id, customer_id, quote_total, portal_request_id")
    .eq("id", jobId)
    .single();
  if (jErr || !job) return { invoice_id: null, error: "job not found" };

  const { data: existing } = await supabase
    .from("customer_invoices")
    .select("id")
    .eq("service_job_id", jobId)
    .maybeSingle();
  if (existing?.id) return { invoice_id: existing.id };

  let portalCustomerId: string | null = null;
  if (job.customer_id) {
    const { data: pc } = await supabase
      .from("portal_customers")
      .select("id")
      .eq("crm_company_id", job.customer_id as string)
      .limit(1)
      .maybeSingle();
    portalCustomerId = pc?.id ?? null;
  }

  const { data: approvedQuote } = await supabase
    .from("service_quotes")
    .select("id, total")
    .eq("job_id", jobId)
    .eq("status", "approved")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let total = Number(job.quote_total ?? approvedQuote?.total ?? 0);
  if (total <= 0 && approvedQuote?.total != null) {
    total = Number(approvedQuote.total);
  }
  if (total <= 0) return { invoice_id: null, error: "no quote_total" };

  const invNo = `SRV-${String(jobId).slice(0, 8).toUpperCase()}`;
  const due = new Date();
  due.setDate(due.getDate() + 30);

  const crmCompanyId = !portalCustomerId && job.customer_id
    ? (job.customer_id as string)
    : null;

  const { data: inv, error: invErr } = await supabase
    .from("customer_invoices")
    .insert({
      workspace_id: job.workspace_id,
      portal_customer_id: portalCustomerId,
      crm_company_id: crmCompanyId,
      invoice_number: invNo,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      description: `Service job ${jobId}`,
      amount: total,
      tax: 0,
      total,
      status: "pending",
      service_job_id: jobId,
      service_request_id: null,
    })
    .select("id")
    .single();

  if (invErr) return { invoice_id: null, error: invErr.message };
  const invoiceId = inv?.id ?? null;
  if (!invoiceId) return { invoice_id: null, error: "insert failed" };

  if (approvedQuote?.id) {
    const { data: quoteLines } = await supabase
      .from("service_quote_lines")
      .select("description, quantity, unit_price, extended_price, sort_order")
      .eq("quote_id", approvedQuote.id)
      .order("sort_order", { ascending: true });

    const ws = job.workspace_id as string;
    let lineNo = 1;
    const rows: Record<string, unknown>[] = [];
    for (const line of quoteLines ?? []) {
      const qty = Number(line.quantity ?? 1);
      const unit = Number(line.unit_price ?? 0);
      const ext = Number(line.extended_price ?? qty * unit);
      rows.push({
        workspace_id: ws,
        invoice_id: invoiceId,
        line_number: lineNo++,
        description: String(line.description ?? "Line").slice(0, 500),
        quantity: qty,
        unit_price: unit || (qty > 0 ? ext / qty : ext),
      });
    }
    if (rows.length === 0) {
      rows.push({
        workspace_id: ws,
        invoice_id: invoiceId,
        line_number: 1,
        description: "Service total",
        quantity: 1,
        unit_price: total,
      });
    }
    const { error: liErr } = await supabase.from("customer_invoice_line_items").insert(rows);
    if (liErr) console.warn("customer_invoice_line_items:", liErr.message);
  } else {
    const { error: liErr } = await supabase.from("customer_invoice_line_items").insert({
      workspace_id: job.workspace_id as string,
      invoice_id: invoiceId,
      line_number: 1,
      description: "Service total",
      quantity: 1,
      unit_price: total,
    });
    if (liErr) console.warn("customer_invoice_line_items:", liErr.message);
  }

  await supabase.from("quickbooks_gl_sync_jobs").upsert({
    workspace_id: job.workspace_id as string,
    invoice_id: invoiceId,
    source_type: "customer_invoice",
    posting_mode: "journal_entry",
    status: "queued",
  }, { onConflict: "invoice_id" });

  await supabase
    .from("customer_invoices")
    .update({ quickbooks_gl_status: "queued", quickbooks_gl_last_error: null })
    .eq("id", invoiceId);

  return { invoice_id: invoiceId };
}
