import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  clearQuickBooksConfig,
  fetchQuickBooksCompanyInfo,
  loadQuickBooksConfigSummary,
  postQuickBooksJournalEntry,
  saveQuickBooksConfig,
  type QuickBooksConfigDraft,
  type QuickBooksInvoiceContext,
} from "../_shared/quickbooks-gl.ts";

type SyncRequest =
  | { action: "config_summary" }
  | { action: "save_config"; config: QuickBooksConfigDraft }
  | { action: "clear_config" }
  | { action: "test_connection" }
  | { action: "sync_invoice"; invoice_id: string }
  | { action: "sync_pending"; limit?: number };

function ensureElevatedRole(role: string, origin: string | null): Response | null {
  if (!["admin", "manager", "owner"].includes(role)) {
    return safeJsonError("Forbidden", 403, origin);
  }
  return null;
}

async function loadInvoice(
  admin: unknown,
  invoiceId: string,
): Promise<QuickBooksInvoiceContext> {
  const { data: invoice, error } = await (admin as unknown as {
    from: (table: string) => {
      select: (columns: string) => { eq: (column: string, value: string) => { single: () => Promise<{ data: Record<string, unknown> | null; error: unknown }> } };
    };
  })
    .from("customer_invoices")
    .select("id, invoice_number, invoice_date, total, tax, description, service_job_id, crm_company_id")
    .eq("id", invoiceId)
    .single();
  if (error || !invoice) throw new Error("Invoice not found");

  const { data: lineItems } = await (admin as unknown as {
    from: (table: string) => {
      select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }> } };
    };
  })
    .from("customer_invoice_line_items")
    .select("id, description, quantity, unit_price, line_total")
    .eq("invoice_id", invoiceId)
    .order("line_number");

  let companyName: string | null = null;
  if (invoice.crm_company_id) {
    const { data: company } = await (admin as unknown as {
      from: (table: string) => {
        select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }> } };
      };
    })
      .from("qrm_companies")
      .select("name")
      .eq("id", invoice.crm_company_id as string)
      .maybeSingle();
    companyName = (company?.name as string | undefined) ?? null;
  }

  return {
    id: invoice.id as string,
    invoice_number: invoice.invoice_number as string,
    invoice_date: invoice.invoice_date as string,
    total: Number(invoice.total ?? 0),
    tax: invoice.tax == null ? null : Number(invoice.tax),
    description: invoice.description as string | null,
    service_job_id: invoice.service_job_id as string | null,
    crm_company_id: invoice.crm_company_id as string | null,
    company_name: companyName,
    line_items: (lineItems ?? []).map((row) => ({
      id: row.id as string,
      description: String(row.description ?? "Invoice line"),
      quantity: Number(row.quantity ?? 1),
      unit_price: Number(row.unit_price ?? 0),
      line_total: row.line_total == null ? null : Number(row.line_total),
    })),
  };
}

async function syncInvoice(
  admin: unknown,
  invoiceId: string,
  workspaceId: string,
  actorId: string,
) {
  const invoice = await loadInvoice(admin, invoiceId);

  await (admin as unknown as {
    from: (table: string) => {
      upsert: (value: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
  })
    .from("quickbooks_gl_sync_jobs")
    .upsert({
      workspace_id: workspaceId,
      invoice_id: invoiceId,
      source_type: "customer_invoice",
      posting_mode: "journal_entry",
      status: "processing",
      attempt_count: 1,
      last_attempt_at: new Date().toISOString(),
      created_by: actorId,
    }, { onConflict: "invoice_id" });

  await (admin as unknown as {
    from: (table: string) => {
      update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
    };
  })
    .from("customer_invoices")
    .update({ quickbooks_gl_status: "processing", quickbooks_gl_last_error: null })
    .eq("id", invoiceId);

  try {
    const result = await postQuickBooksJournalEntry(admin, invoice, workspaceId);

    await (admin as unknown as {
      from: (table: string) => {
        update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
      };
    })
      .from("quickbooks_gl_sync_jobs")
      .update({
        status: "posted",
        quickbooks_txn_id: result.txnId,
        request_payload: result.requestPayload,
        response_payload: result.responsePayload,
        error_message: null,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("invoice_id", invoiceId);

    await (admin as unknown as {
      from: (table: string) => {
        update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
      };
    })
      .from("customer_invoices")
      .update({
        quickbooks_gl_status: "posted",
        quickbooks_gl_txn_id: result.txnId,
        quickbooks_gl_synced_at: new Date().toISOString(),
        quickbooks_gl_last_error: null,
      })
      .eq("id", invoiceId);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await (admin as unknown as {
      from: (table: string) => {
        update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
      };
    })
      .from("quickbooks_gl_sync_jobs")
      .update({
        status: "failed",
        error_message: message,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("invoice_id", invoiceId);
    await (admin as unknown as {
      from: (table: string) => {
        update: (value: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
      };
    })
      .from("customer_invoices")
      .update({ quickbooks_gl_status: "failed", quickbooks_gl_last_error: message })
      .eq("id", invoiceId);
    throw err;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const forbidden = ensureElevatedRole(auth.role, origin);
    if (forbidden) return forbidden;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({})) as SyncRequest;
    switch (body.action) {
      case "config_summary": {
        const summary = await loadQuickBooksConfigSummary(admin, auth.workspaceId);
        return safeJsonOk({ ok: true, summary }, origin);
      }
      case "save_config": {
        const summary = await saveQuickBooksConfig(admin, body.config ?? {}, auth.workspaceId);
        return safeJsonOk({ ok: true, summary }, origin);
      }
      case "clear_config": {
        const summary = await clearQuickBooksConfig(admin, auth.workspaceId);
        return safeJsonOk({ ok: true, summary }, origin);
      }
      case "test_connection": {
        const companyInfo = await fetchQuickBooksCompanyInfo(admin, auth.workspaceId);
        return safeJsonOk({ ok: true, company_info: companyInfo }, origin);
      }
      case "sync_invoice": {
        const result = await syncInvoice(admin, body.invoice_id, auth.workspaceId, auth.userId);
        return safeJsonOk({ ok: true, ...result }, origin);
      }
      case "sync_pending": {
        const limit = Math.max(1, Math.min(25, Number(body.limit ?? 10)));
        const { data: jobs } = await (admin as unknown as {
          from: (table: string) => {
            select: (columns: string) => {
              eq: (column: string, value: string) => {
                in: (column: string, values: string[]) => {
                  order: (column: string, opts?: Record<string, boolean>) => {
                    limit: (count: number) => Promise<{ data: Array<{ invoice_id: string }> | null; error: unknown }>;
                  };
                };
              };
            };
          };
        })
          .from("quickbooks_gl_sync_jobs")
          .select("invoice_id")
          .eq("workspace_id", auth.workspaceId)
          .in("status", ["queued", "failed"])
          .order("created_at", { ascending: true })
          .limit(limit);

        const results = [];
        for (const job of jobs ?? []) {
          const posted = await syncInvoice(admin, job.invoice_id as string, auth.workspaceId, auth.userId);
          results.push({ invoice_id: job.invoice_id, quickbooks_txn_id: posted.txnId });
        }
        return safeJsonOk({ ok: true, synced: results }, origin);
      }
      default:
        return safeJsonError("Unknown action", 400, origin);
    }
  } catch (err) {
    captureEdgeException(err, { fn: "quickbooks-gl-sync", req });
    console.error("quickbooks-gl-sync error:", err);
    return safeJsonError(err instanceof Error ? err.message : "Internal server error", 500, req.headers.get("origin"));
  }
});
