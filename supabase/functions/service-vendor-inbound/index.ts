/**
 * Inbound vendor email / webhook — extract PO reference and update parts actions.
 * verify_jwt false; protect with shared secret header in production.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  const secret = Deno.env.get("VENDOR_INBOUND_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-webhook-secret") !== secret) {
    return safeJsonError("Unauthorized", 401, null);
  }

  try {
    const body = await req.json() as {
      raw_text?: string;
      po_reference?: string;
      expected_date?: string;
      requirement_id?: string;
      job_id?: string;
      part_number?: string;
    };
    const strictInbound =
      Deno.env.get("ENV") === "production" ||
      Boolean(Deno.env.get("VENDOR_INBOUND_WEBHOOK_SECRET"));
    const allowOpenOrderMatch =
      Deno.env.get("ALLOW_VENDOR_INBOUND_OPEN_MATCH") === "true";

    const hasStrongIds = Boolean(body.requirement_id) ||
      (Boolean(body.job_id) &&
        body.part_number != null &&
        String(body.part_number).trim() !== "");

    if (strictInbound && !hasStrongIds) {
      return safeJsonError(
        "requirement_id or (job_id + part_number) required in production or when VENDOR_INBOUND_WEBHOOK_SECRET is set",
        400,
        null,
      );
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);

    const text = body.raw_text ?? "";
    const po = body.po_reference ??
      (text.match(/\b(PO|po)[\s#:-]*([A-Z0-9-]+)/i)?.[2] ?? null);

    const patch: Record<string, unknown> = {
      expected_date: body.expected_date ?? null,
      metadata: { inbound_parse: true, at: new Date().toISOString() },
    };
    if (po) patch.po_reference = po;

    if (body.requirement_id) {
      const { data: row, error } = await supabase
        .from("service_parts_actions")
        .update(patch)
        .eq("requirement_id", body.requirement_id)
        .eq("action_type", "order")
        .is("completed_at", null)
        .is("superseded_at", null)
        .select("id")
        .maybeSingle();
      if (error) return safeJsonError(error.message, 400, null);
      if (!row?.id) {
        return safeJsonOk({ ok: true, po_reference: po, updated: null }, null);
      }
      const { data: reqMeta } = await supabase
        .from("service_parts_requirements")
        .select("vendor_id")
        .eq("id", body.requirement_id)
        .maybeSingle();
      if (reqMeta?.vendor_id) {
        const { data: vp } = await supabase
          .from("vendor_profiles")
          .select("responsiveness_score")
          .eq("id", reqMeta.vendor_id)
          .maybeSingle();
        if (vp) {
          const next = Math.min(1, Number(vp.responsiveness_score ?? 0.5) + 0.02);
          await supabase
            .from("vendor_profiles")
            .update({
              responsiveness_score: next,
              updated_at: new Date().toISOString(),
            })
            .eq("id", reqMeta.vendor_id);
        }
      }
      return safeJsonOk({ ok: true, po_reference: po, updated: row?.id ?? null }, null);
    }

    if (body.job_id && body.part_number) {
      const { data: reqRow } = await supabase
        .from("service_parts_requirements")
        .select("id")
        .eq("job_id", body.job_id)
        .eq("part_number", String(body.part_number).trim())
        .neq("status", "cancelled")
        .maybeSingle();
      if (reqRow?.id) {
        const { data: row, error } = await supabase
          .from("service_parts_actions")
          .update(patch)
          .eq("requirement_id", reqRow.id)
          .eq("action_type", "order")
          .is("completed_at", null)
          .is("superseded_at", null)
          .select("id")
          .maybeSingle();
        if (error) return safeJsonError(error.message, 400, null);
        return safeJsonOk({ ok: true, po_reference: po, updated: row?.id ?? null }, null);
      }
    }

    // Never match "first open order" in strict mode (prod or webhook secret), even if env flag is on.
    if (po && allowOpenOrderMatch && !strictInbound) {
      const { data: open } = await supabase
        .from("service_parts_actions")
        .select("id")
        .eq("action_type", "order")
        .is("po_reference", null)
        .is("completed_at", null)
        .is("superseded_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (open?.id) {
        const { error } = await supabase
          .from("service_parts_actions")
          .update(patch)
          .eq("id", open.id);
        if (error) return safeJsonError(error.message, 400, null);
        return safeJsonOk({ ok: true, po_reference: po, updated: open.id }, null);
      }
    }

    return safeJsonOk({
      ok: true,
      po_reference: po,
      updated: null,
      message: "No matching open order action — pass requirement_id or job_id+part_number",
    }, null);
  } catch (e) {
    console.error("service-vendor-inbound:", e);
    return safeJsonError("Bad request", 400, null);
  }
});
