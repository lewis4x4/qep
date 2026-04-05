/**
 * Customer Portal API Edge Function
 *
 * Unified API for the customer self-service portal.
 * Routes: /fleet, /service-requests, /parts, /invoices, /quotes
 *
 * Auth: Portal customer (via auth_user_id → portal_customers mapping)
 * OR internal staff with workspace access.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import {
  buildPmKitLinesFromJobCode,
  deterministicPmReason,
  explainPmKitWithLlm,
  sanitizePortalLineItemsForOrder,
  scoreJobCodeForFleet,
  type CustomerFleetRow,
  type JobCodePmRow,
} from "../_shared/portal-pm-kit.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnon) {
      return safeJsonError("Service misconfigured", 503, origin);
    }

    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnon,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // Verify caller is a portal customer (not internal staff using wrong API)
    const { data: portalCustomer } = await supabase
      .from("portal_customers")
      .select("id, is_active, workspace_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!portalCustomer) {
      return safeJsonError("Not a portal customer. Use internal QRM API.", 403, origin);
    }
    if (!portalCustomer.is_active) {
      return safeJsonError("Portal account is deactivated.", 403, origin);
    }

    const portalWorkspaceId = portalCustomer.workspace_id as string;

    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/^\/functions\/v1\/portal-api\/?/, "");
    const pathParts = rawPath.split("/").filter(Boolean);
    const route = pathParts[0] ?? "";
    const subRoute = pathParts[1] ?? "";

    // ── /fleet — Customer equipment fleet ──────────────────────────────
    if (route === "fleet") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("customer_fleet")
          .select("*, maintenance_schedules(*)")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load fleet", 500, origin);
        return safeJsonOk({ fleet: data }, origin);
      }
    }

    // ── /service-requests — Service request CRUD ───────────────────────
    if (route === "service-requests") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("service_requests")
          .select(`
            *,
            internal_job:service_jobs (
              id,
              current_stage,
              priority,
              updated_at,
              closed_at
            )
          `)
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load requests", 500, origin);
        return safeJsonOk({ requests: data }, origin);
      }

      if (req.method === "POST") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        if (!body.request_type || !body.description) {
          return safeJsonError("request_type and description required", 400, origin);
        }

        const validTypes = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];
        if (!validTypes.includes(String(body.request_type))) {
          return safeJsonError(`request_type must be one of: ${validTypes.join(", ")}`, 400, origin);
        }

        const validUrgencies = ["low", "normal", "high", "emergency"];
        if (body.urgency && !validUrgencies.includes(String(body.urgency))) {
          return safeJsonError(`urgency must be one of: ${validUrgencies.join(", ")}`, 400, origin);
        }

        // Whitelist safe fields — block billing/status manipulation
        const safeBody = {
          workspace_id: portalWorkspaceId,
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id ?? null,
          request_type: body.request_type,
          description: body.description,
          urgency: (body.urgency as string) || "normal",
          photos: Array.isArray(body.photos) ? body.photos : [],
          preferred_date: body.preferred_date ?? null,
          preferred_branch: body.preferred_branch ?? null,
        };

        const { data, error } = await supabase
          .from("service_requests")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to create request", 500, origin);
        return safeJsonOk({ request: data }, origin, 201);
      }
    }

    // ── /parts — Parts orders ──────────────────────────────────────────
    if (route === "parts") {
      // POST /parts/suggest-pm-kit — AI-assisted PM kit from job_codes + optional LLM narrative
      if (subRoute === "suggest-pm-kit" && req.method === "POST") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("PM kit suggestions are not configured on this environment.", 503, origin);
        }

        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const fleetId = typeof body.fleet_id === "string" ? body.fleet_id.trim() : "";
        if (!fleetId) {
          return safeJsonError("fleet_id is required", 400, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: fleetRow, error: fleetErr } = await admin
          .from("customer_fleet")
          .select(
            "id, make, model, serial_number, current_hours, next_service_due, service_interval_hours, workspace_id, portal_customer_id",
          )
          .eq("id", fleetId)
          .eq("portal_customer_id", portalCustomer.id)
          .eq("workspace_id", portalWorkspaceId)
          .maybeSingle();

        if (fleetErr || !fleetRow) {
          return safeJsonError("Fleet machine not found for this account.", 404, origin);
        }

        const fleet = fleetRow as CustomerFleetRow;
        const makeTrim = fleet.make?.trim() ?? "";
        if (!makeTrim) {
          return safeJsonError("Fleet record is missing equipment make.", 400, origin);
        }

        let { data: jobCodes } = await admin
          .from("job_codes")
          .select("id, job_name, make, model_family, parts_template, common_add_ons, confidence_score")
          .eq("workspace_id", portalWorkspaceId)
          .eq("make", makeTrim)
          .order("confidence_score", { ascending: false })
          .limit(25);

        if (!jobCodes?.length) {
          const { data: fuzzy } = await admin
            .from("job_codes")
            .select("id, job_name, make, model_family, parts_template, common_add_ons, confidence_score")
            .eq("workspace_id", portalWorkspaceId)
            .ilike("make", `%${makeTrim}%`)
            .order("confidence_score", { ascending: false })
            .limit(25);
          jobCodes = fuzzy ?? [];
        }

        const codes = (jobCodes ?? []) as JobCodePmRow[];
        if (codes.length === 0) {
          return safeJsonOk({
            ok: false,
            error: "no_job_code_match",
            message:
              "No dealership PM template is on file for this equipment make yet. Enter part numbers manually or contact parts.",
          }, origin);
        }

        const sorted = [...codes].sort(
          (a, b) => scoreJobCodeForFleet(b, fleet) - scoreJobCodeForFleet(a, fleet),
        );
        const chosen = sorted[0];
        const lineItems = buildPmKitLinesFromJobCode(chosen);
        if (lineItems.length === 0) {
          return safeJsonOk({
            ok: false,
            error: "empty_template",
            message:
              "A job code matched your machine but its PM parts list is empty. Add lines manually or ask your dealer to publish templates.",
            matched_job_code: {
              id: chosen.id,
              job_name: chosen.job_name,
              make: chosen.make,
              model_family: chosen.model_family,
            },
          }, origin);
        }

        const apiKey = Deno.env.get("OPENAI_API_KEY");
        const fallbackReason = deterministicPmReason(fleet, chosen, lineItems.length);
        const aiReason = (await explainPmKitWithLlm(apiKey, fleet, chosen, lineItems)) ?? fallbackReason;

        return safeJsonOk({
          ok: true,
          ai_suggested_pm_kit: true,
          ai_suggestion_reason: aiReason,
          line_items: lineItems.map((l) => ({
            part_number: l.part_number,
            quantity: l.quantity,
            description: l.description,
            unit_price: l.unit_price,
            is_ai_suggested: true,
          })),
          matched_job_code: {
            id: chosen.id,
            job_name: chosen.job_name,
            make: chosen.make,
            model_family: chosen.model_family,
          },
        }, origin);
      }

      // POST /parts/submit — draft → submitted (validated here; RLS blocks naive status bumps)
      if (subRoute === "submit" && req.method === "POST") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Order submission is not configured on this environment.", 503, origin);
        }
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
        if (!orderId) {
          return safeJsonError("order_id is required", 400, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: row, error: fetchErr } = await admin
          .from("parts_orders")
          .select("id, portal_customer_id, status, workspace_id")
          .eq("id", orderId)
          .maybeSingle();

        if (fetchErr || !row) {
          return safeJsonError("Order not found.", 404, origin);
        }
        if (row.portal_customer_id !== portalCustomer.id || row.workspace_id !== portalWorkspaceId) {
          return safeJsonError("Order not found.", 404, origin);
        }
        if (row.status !== "draft") {
          return safeJsonError("Only draft orders can be submitted to the dealership.", 400, origin);
        }

        const { data: updated, error: upErr } = await admin
          .from("parts_orders")
          .update({ status: "submitted" })
          .eq("id", orderId)
          .select()
          .single();

        if (upErr) {
          console.error("portal-api parts submit:", upErr);
          return safeJsonError("Failed to submit order", 500, origin);
        }

        const shortRef = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();

        try {
          const { data: pc } = await admin
            .from("portal_customers")
            .select("email, notification_preferences, first_name, last_name")
            .eq("id", portalCustomer.id)
            .maybeSingle();
          const custLabel = [pc?.first_name, pc?.last_name].filter(Boolean).join(" ").trim() || "Portal customer";

          const prefs = pc?.notification_preferences as { email?: boolean } | undefined;
          const em = typeof pc?.email === "string" ? pc.email.trim() : "";
          if (prefs?.email !== false && em.includes("@")) {
            await sendResendEmail({
              to: em,
              subject: `QEP — Parts order submitted (${shortRef})`,
              text:
                `Your parts order request was submitted to the dealership.\n\n` +
                `Reference: ${shortRef}\n\n` +
                `We will confirm availability and contact you if anything changes.\n\n` +
                `— Quality Equipment & Parts`,
            });
          }

          const { data: recipients } = await admin
            .from("profiles")
            .select("id")
            .in("role", ["rep", "admin", "manager", "owner"]);
          const rows = (recipients ?? []).map((r) => ({
            workspace_id: portalWorkspaceId,
            user_id: r.id as string,
            kind: "service_portal_parts_submitted",
            title: "Portal parts order submitted",
            body:
              `${custLabel} submitted a parts order (${shortRef}). Open Service → Portal orders to process.`,
            metadata: {
              parts_order_id: orderId,
              notification_type: "portal_parts_submitted",
            },
          }));
          if (rows.length > 0) {
            const { error: niErr } = await admin.from("crm_in_app_notifications").insert(rows);
            if (niErr) console.warn("portal-api staff in-app notify:", niErr);
          }
        } catch (e) {
          console.warn("portal-api submit notify:", e);
        }

        return safeJsonOk({ order: updated }, origin);
      }

      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("parts_orders")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load orders", 500, origin);
        return safeJsonOk({ orders: data }, origin);
      }

      if (req.method === "POST") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;

        const line_items = sanitizePortalLineItemsForOrder(body.line_items);
        if (line_items.length === 0) {
          return safeJsonError("line_items array is required with at least one valid item", 400, origin);
        }

        const aiReason =
          typeof body.ai_suggestion_reason === "string"
            ? body.ai_suggestion_reason.trim().slice(0, 2000)
            : null;

        // Whitelist safe fields — totals computed server-side, not customer-provided
        const safeBody: Record<string, unknown> = {
          workspace_id: portalWorkspaceId,
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          status: "draft", // Always start as draft
          line_items,
          shipping_address: body.shipping_address || null,
        };

        if (body.ai_suggested_pm_kit === true) {
          safeBody.ai_suggested_pm_kit = true;
          safeBody.ai_suggestion_reason = aiReason;
        }

        const { data, error } = await supabase
          .from("parts_orders")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to create order", 500, origin);
        return safeJsonOk({ order: data }, origin, 201);
      }
    }

    // ── /invoices — Payment portal ─────────────────────────────────────
    if (route === "invoices") {
      if (req.method === "GET" && !subRoute) {
        const { data, error } = await supabase
          .from("customer_invoices")
          .select("*, customer_invoice_line_items(*)")
          .order("invoice_date", { ascending: false });

        if (error) return safeJsonError("Failed to load invoices", 500, origin);
        return safeJsonOk({ invoices: data }, origin);
      }

      if (req.method === "POST" && subRoute === "pay") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as {
          invoice_id?: string;
          amount?: number;
          payment_method?: string;
          payment_reference?: string;
        };
        if (!body.invoice_id || body.amount == null) {
          return safeJsonError("invoice_id and amount required", 400, origin);
        }
        const amt = Number(body.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return safeJsonError("amount must be a positive number", 400, origin);
        }

        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          "portal_record_invoice_payment",
          {
            p_invoice_id: body.invoice_id,
            p_amount: amt,
            p_payment_method: body.payment_method ?? null,
            p_payment_reference: body.payment_reference ?? null,
          },
        );
        if (rpcErr) return safeJsonError(rpcErr.message, 400, origin);
        const res = rpcResult as { ok?: boolean; error?: string };
        if (!res?.ok) {
          return safeJsonError(res?.error ?? "payment_failed", 400, origin);
        }
        return safeJsonOk({ ok: true, result: rpcResult }, origin);
      }
    }

    // ── /quotes — Quote review + e-signature ───────────────────────────
    if (route === "quotes") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("portal_quote_reviews")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load quotes", 500, origin);
        return safeJsonOk({ quotes: data }, origin);
      }

      if (req.method === "PUT") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        if (!body.id) return safeJsonError("id required", 400, origin);

        const validStatuses = ["viewed", "accepted", "rejected", "countered"];
        if (body.status && !validStatuses.includes(String(body.status))) {
          return safeJsonError(`status must be one of: ${validStatuses.join(", ")}`, 400, origin);
        }

        // Build safe update — customers cannot set signature fields directly
        const safeUpdates: Record<string, unknown> = {};

        if (body.status === "viewed") {
          safeUpdates.status = "viewed";
          safeUpdates.viewed_at = new Date().toISOString();
        } else if (body.status === "accepted") {
          if (!body.signer_name || typeof body.signer_name !== "string") {
            return safeJsonError("signer_name required when accepting", 400, origin);
          }
          // Sanitize: strip HTML tags, limit length
          const cleanName = body.signer_name.replace(/<[^>]*>/g, "").trim().substring(0, 100);
          if (!cleanName) {
            return safeJsonError("signer_name cannot be empty", 400, origin);
          }
          safeUpdates.status = "accepted";
          safeUpdates.signer_name = cleanName;
          safeUpdates.signed_at = new Date().toISOString();
          if (body.signature_png_base64 && typeof body.signature_png_base64 === "string") {
            const raw = String(body.signature_png_base64).replace(/\s/g, "");
            if (raw.length > 400_000) {
              return safeJsonError("signature image too large", 400, origin);
            }
            if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
              return safeJsonError("signature must be base64 PNG", 400, origin);
            }
            safeUpdates.signature_url = `data:image/png;base64,${raw}`;
          }
          // Use Cloudflare's trusted header, fallback chain for non-CF environments
          safeUpdates.signer_ip = req.headers.get("cf-connecting-ip")
            || req.headers.get("x-real-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || "unknown";
          // signature_url would be set by a separate upload flow
        } else if (body.status === "rejected") {
          safeUpdates.status = "rejected";
        } else if (body.status === "countered") {
          safeUpdates.status = "countered";
          safeUpdates.counter_notes = body.counter_notes || null;
        }

        if (Object.keys(safeUpdates).length === 0) {
          return safeJsonError("No valid fields to update", 400, origin);
        }

        const { data, error } = await supabase
          .from("portal_quote_reviews")
          .update(safeUpdates)
          .eq("id", body.id)
          .select()
          .single();

        if (error) return safeJsonError("Failed to update quote", 500, origin);
        return safeJsonOk({ quote: data }, origin);
      }
    }

    // ── /subscriptions — EaaS subscriptions ────────────────────────────
    if (route === "subscriptions") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("eaas_subscriptions")
          .select("*, eaas_usage_records(*)")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load subscriptions", 500, origin);
        return safeJsonOk({ subscriptions: data }, origin);
      }
    }

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    console.error("portal-api error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
