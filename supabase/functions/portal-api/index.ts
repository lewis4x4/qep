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

        const { data, error } = await supabase
          .from("service_requests")
          .insert(body)
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
        const { data, error } = await supabase
          .from("parts_orders")
          .insert(body)
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

        const { id, ...updates } = body;

        // Track signature
        if (updates.status === "accepted" && updates.signer_name) {
          updates.signed_at = new Date().toISOString();
          updates.signer_ip = req.headers.get("x-forwarded-for") || "unknown";
        }

        if (updates.status === "viewed" && !updates.viewed_at) {
          updates.viewed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
          .from("portal_quote_reviews")
          .update(updates)
          .eq("id", id)
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
