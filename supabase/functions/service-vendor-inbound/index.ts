/**
 * Inbound vendor email / webhook — extract PO reference and update parts actions.
 * verify_jwt false; protect with shared secret header in production.
 *
 * Optional EDI/API-shaped JSON (validated when present): `edi_control_number`,
 * `vendor_transaction_id`, `asn_reference`, `shipment_reference`,
 * `vendor_message_type`, `line_items[]` — see `_shared/vendor-inbound-contract.ts`.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  mirrorToFulfillmentRun,
  normalizeFulfillmentEventIdempotencyKey,
} from "../_shared/parts-fulfillment-mirror.ts";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { parseVendorInboundContract } from "../_shared/vendor-inbound-contract.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  const secret = Deno.env.get("VENDOR_INBOUND_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-webhook-secret") !== secret) {
    return safeJsonError("Unauthorized", 401, null);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Service misconfigured", 503, null);
  }

  try {
    const parsed = await parseJsonBody(req, null);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as {
      raw_text?: string;
      po_reference?: string;
      expected_date?: string;
      requirement_id?: string;
      job_id?: string;
      part_number?: string;
      idempotency_key?: string;
    };

    const {
      contract: vendorContract,
      error: contractError,
    } = parseVendorInboundContract(body as Record<string, unknown>);
    if (contractError) {
      return safeJsonError(contractError, 400, null);
    }

    const clientIdempotencyKey =
      normalizeFulfillmentEventIdempotencyKey(
        req.headers.get("Idempotency-Key") ?? req.headers.get("x-idempotency-key"),
      ) ?? normalizeFulfillmentEventIdempotencyKey(body.idempotency_key);
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

    const supabase = createClient(supabaseUrl, serviceKey);

    const text = body.raw_text ?? "";
    const po = body.po_reference ??
      (text.match(/\b(PO|po)[\s#:-]*([A-Z0-9-]+)/i)?.[2] ?? null);

    const patch: Record<string, unknown> = {
      expected_date: body.expected_date ?? null,
      metadata: {
        inbound_parse: true,
        at: new Date().toISOString(),
        ...(vendorContract ? { vendor_contract: vendorContract } : {}),
      },
    };
    if (po) patch.po_reference = po;

    const vendorMirrorPayload = vendorContract
      ? { vendor_contract: vendorContract }
      : {};

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
        .select("vendor_id, job_id, workspace_id")
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
      if (reqMeta?.job_id && reqMeta.workspace_id) {
        const ws = reqMeta.workspace_id as string;
        const idempotencyKey =
          clientIdempotencyKey ??
          `inbound:${ws}:${row.id}:${po ?? ""}`;
        const mirror = await mirrorToFulfillmentRun(supabase, {
          jobId: reqMeta.job_id as string,
          workspaceId: ws,
          eventType: "shop_vendor_inbound",
          auditChannel: "vendor",
          idempotencyKey,
          payload: {
            requirement_id: body.requirement_id,
            po_reference: po,
            service_parts_action_id: row.id,
            source: "service-vendor-inbound",
            ...vendorMirrorPayload,
          },
        });
        if (!mirror.skipped && mirror.duplicate) {
          return safeJsonOk(
            {
              ok: true,
              po_reference: po,
              updated: row?.id ?? null,
              fulfillment_event_deduplicated: true,
            },
            null,
          );
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
        const { data: sj } = await supabase
          .from("service_jobs")
          .select("workspace_id")
          .eq("id", body.job_id)
          .maybeSingle();
        if (sj?.workspace_id) {
          const ws = sj.workspace_id as string;
          const idempotencyKey =
            clientIdempotencyKey ??
            (row?.id ? `inbound:${ws}:${row.id}:${po ?? ""}` : undefined);
          const mirror = await mirrorToFulfillmentRun(supabase, {
            jobId: body.job_id,
            workspaceId: ws,
            eventType: "shop_vendor_inbound",
            auditChannel: "vendor",
            idempotencyKey,
            payload: {
              part_number: body.part_number,
              po_reference: po,
              service_parts_action_id: row?.id,
              source: "service-vendor-inbound",
              ...vendorMirrorPayload,
            },
          });
          if (!mirror.skipped && mirror.duplicate) {
            return safeJsonOk(
              {
                ok: true,
                po_reference: po,
                updated: row?.id ?? null,
                fulfillment_event_deduplicated: true,
              },
              null,
            );
          }
        }
        return safeJsonOk({ ok: true, po_reference: po, updated: row?.id ?? null }, null);
      }
    }

    // Never match "first open order" in strict mode (prod or webhook secret), even if env flag is on.
    if (po && allowOpenOrderMatch && !strictInbound) {
      const { data: open } = await supabase
        .from("service_parts_actions")
        .select("id, job_id, workspace_id")
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
        if (open.job_id && open.workspace_id) {
          const ws = open.workspace_id as string;
          const idempotencyKey =
            clientIdempotencyKey ?? `inbound:${ws}:${open.id}:${po ?? ""}`;
          const mirror = await mirrorToFulfillmentRun(supabase, {
            jobId: open.job_id as string,
            workspaceId: ws,
            eventType: "shop_vendor_inbound",
            auditChannel: "vendor",
            idempotencyKey,
            payload: {
              service_parts_action_id: open.id,
              po_reference: po,
              match: "open_order",
              source: "service-vendor-inbound",
              ...vendorMirrorPayload,
            },
          });
          if (!mirror.skipped && mirror.duplicate) {
            return safeJsonOk(
              {
                ok: true,
                po_reference: po,
                updated: open.id,
                fulfillment_event_deduplicated: true,
              },
              null,
            );
          }
        }
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
    captureEdgeException(e, { fn: "service-vendor-inbound", req });
    console.error("service-vendor-inbound:", e);
    return safeJsonError("Bad request", 400, null);
  }
});
