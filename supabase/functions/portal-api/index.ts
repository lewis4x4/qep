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
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // Verify caller is a portal customer (not internal staff using wrong API)
    const { data: portalCustomer } = await supabase
      .from("portal_customers")
      .select("id, is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!portalCustomer) {
      return safeJsonError("Not a portal customer. Use internal QRM API.", 403, origin);
    }
    if (!portalCustomer.is_active) {
      return safeJsonError("Portal account is deactivated.", 403, origin);
    }

    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/functions\/v1\/portal-api\/?/, "").split("/")[0] || "";

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
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load requests", 500, origin);
        return safeJsonOk({ requests: data }, origin);
      }

      if (req.method === "POST") {
        const body = await req.json();
        if (!body.request_type || !body.description) {
          return safeJsonError("request_type and description required", 400, origin);
        }

        const validTypes = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];
        if (!validTypes.includes(body.request_type)) {
          return safeJsonError(`request_type must be one of: ${validTypes.join(", ")}`, 400, origin);
        }

        const validUrgencies = ["low", "normal", "high", "emergency"];
        if (body.urgency && !validUrgencies.includes(body.urgency)) {
          return safeJsonError(`urgency must be one of: ${validUrgencies.join(", ")}`, 400, origin);
        }

        // Whitelist safe fields — block billing/status manipulation
        const safeBody = {
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          request_type: body.request_type,
          description: body.description,
          urgency: body.urgency || "normal",
          photos: Array.isArray(body.photos) ? body.photos : [],
          preferred_date: body.preferred_date || null,
          preferred_branch: body.preferred_branch || null,
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
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("parts_orders")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load orders", 500, origin);
        return safeJsonOk({ orders: data }, origin);
      }

      if (req.method === "POST") {
        const body = await req.json();

        if (!body.line_items || !Array.isArray(body.line_items) || body.line_items.length === 0) {
          return safeJsonError("line_items array is required with at least one item", 400, origin);
        }

        // Whitelist safe fields — totals computed server-side, not customer-provided
        const safeBody = {
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          status: "draft", // Always start as draft
          line_items: body.line_items,
          shipping_address: body.shipping_address || null,
        };

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
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("customer_invoices")
          .select("*")
          .order("invoice_date", { ascending: false });

        if (error) return safeJsonError("Failed to load invoices", 500, origin);
        return safeJsonOk({ invoices: data }, origin);
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
        const body = await req.json();
        if (!body.id) return safeJsonError("id required", 400, origin);

        const validStatuses = ["viewed", "accepted", "rejected", "countered"];
        if (body.status && !validStatuses.includes(body.status)) {
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
