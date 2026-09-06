/**
 * equipment-invoice-runner (Stream M / M1.1, blueprint §2).
 *
 * Sweeps deals that have reached delivery (crm_deal_stages named
 * 'Delivery Completed' / 'Invoice Closed', or any closed-won stage) and still
 * lack an equipment invoice, and generates the customer_invoices row via
 * _shared/equipment-invoice.ts. Stage moves happen from the pipeline UI, the
 * QRM router, and automations — sweeping the stage set catches every source
 * and doubles as backfill, the same shape as rental-billing-runner.
 *
 * pg_cron every 10 minutes (migration 788) + manual invocation with the
 * internal service secret. Targeted mode: POST {"deal_id": "..."} invoices
 * one deal immediately regardless of stage (operator action — the generator
 * still requires an accepted quote package and is idempotent per deal).
 *
 * Per-deal failures dead-letter to exception_queue('equipment_billing_failed')
 * without aborting the run.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { generateInvoiceForEquipmentDeal } from "../_shared/equipment-invoice.ts";

const MAX_DEALS_PER_RUN = 50;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("service-role or internal-service-secret required", 401, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server misconfiguration", 500, origin);
    // deno-lint-ignore no-explicit-any
    const admin: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({})) as { deal_id?: string; limit?: number };

    if (typeof body.deal_id === "string" && body.deal_id.length > 0) {
      const result = await generateInvoiceForEquipmentDeal(admin, body.deal_id);
      return safeJsonOk({ ok: true, mode: "targeted", result }, origin);
    }

    const limit = Math.max(1, Math.min(MAX_DEALS_PER_RUN, Number(body.limit ?? MAX_DEALS_PER_RUN)));

    const { data: candidatesRows, error: candidatesError } = await admin.rpc("select_equipment_invoice_candidates", { p_limit: limit });
    if (candidatesError) throw new Error(candidatesError.message);
    const candidates = (candidatesRows ?? []).map((row: { deal_id: string }) => row.deal_id);
    const summary = {
      examined: 0, invoiced: 0, skipped_already_invoiced: 0, skipped_no_quote: 0, failed: 0,
      invoices: [] as Array<{ deal_id: string; invoice_id: string; invoice_number: string; total: number; warnings: string[] }>,
    };

    for (const dealId of candidates) {
      summary.examined++;
      try {
        const result = await generateInvoiceForEquipmentDeal(admin, dealId);
        if (result.status === "created") {
          summary.invoiced++;
          summary.invoices.push({
            deal_id: dealId,
            invoice_id: result.invoiceId,
            invoice_number: result.invoiceNumber,
            total: result.total,
            warnings: result.warnings,
          });
        } else if (result.reason === "no_accepted_quote") {
          summary.skipped_no_quote++;
        } else {
          summary.skipped_already_invoiced++;
        }
      } catch (err) {
        summary.failed++;
        const message = err instanceof Error ? err.message : String(err);
        captureEdgeException(err, { fn: "equipment-invoice-runner", req });
        await admin.rpc("enqueue_exception", {
          p_source: "equipment_billing_failed",
          p_title: `Equipment invoicing failed for deal ${dealId}`.slice(0, 200),
          p_severity: "error",
          p_detail: message.slice(0, 1000),
          p_payload: { deal_id: dealId },
          p_entity_table: "crm_deals",
          p_entity_id: dealId,
        });
      }
    }

    return safeJsonOk({ ok: true, mode: "sweep", summary }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "equipment-invoice-runner", req });
    console.error("equipment-invoice-runner error:", err);
    return safeJsonError(err instanceof Error ? err.message : "Internal server error", 500, origin);
  }
});
