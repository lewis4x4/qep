/**
 * Meta Social Posting Edge Function
 *
 * Publishes equipment listings and marketing content to Facebook/Instagram.
 * Uses Meta Graph API for Facebook Marketplace auto-posting.
 *
 * POST /post: Create a social media post
 * POST /schedule: Schedule a post for future publishing
 * GET /accounts: List configured social accounts
 *
 * Auth: admin/owner (manual) or service_role (marketing-engine cron)
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
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

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    // Only create admin client when actually needed (service-role path)
    let supabaseAdmin: SupabaseClient | null = null;
    if (isServiceRole) {
      supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey!,
      );
    }

    // Validate user auth for manual invocation
    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      // Create admin client only after user is verified for role check
      supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey!,
      );

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || !["admin", "owner"].includes(profile.role)) {
        return safeJsonError("Social posting requires admin or owner role", 403, origin);
      }
    }

    if (!supabaseAdmin) {
      return safeJsonError("Server misconfiguration", 500, origin);
    }

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    // GET /accounts
    if (req.method === "GET" && action === "accounts") {
      const { data, error } = await supabaseAdmin
        .from("social_accounts")
        .select("id, platform, account_name, is_active, last_posted_at")
        .order("platform");
      if (error) return safeJsonError("Failed to load accounts", 500, origin);
      return safeJsonOk({ accounts: data }, origin);
    }

    if (req.method !== "POST") {
      return safeJsonError("Method not allowed", 405, origin);
    }

    const body = await req.json();

    // POST /post: Publish immediately
    if (action === "post") {
      if (!body.platform || !body.content_text) {
        return safeJsonError("platform and content_text required", 400, origin);
      }

      // Create social_media_posts record
      const { data: post, error: postError } = await supabaseAdmin
        .from("social_media_posts")
        .insert({
          workspace_id: body.workspace_id || "default",
          campaign_id: body.campaign_id || null,
          equipment_id: body.equipment_id || null,
          platform: body.platform,
          content_text: body.content_text,
          images: body.images || [],
          link_url: body.link_url || null,
          status: "posted",
          posted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (postError) {
        return safeJsonError("Failed to create post record", 500, origin);
      }

      // Meta Graph API publish is not wired; DB row records intent; clients use meta_api.
      return safeJsonOk({ post, meta_api: "pending_integration" }, origin, 201);
    }

    // POST /schedule: Schedule for later
    if (action === "schedule") {
      if (!body.platform || !body.content_text || !body.scheduled_at) {
        return safeJsonError("platform, content_text, and scheduled_at required", 400, origin);
      }

      const { data: post, error: postError } = await supabaseAdmin
        .from("social_media_posts")
        .insert({
          workspace_id: body.workspace_id || "default",
          campaign_id: body.campaign_id || null,
          equipment_id: body.equipment_id || null,
          platform: body.platform,
          content_text: body.content_text,
          images: body.images || [],
          link_url: body.link_url || null,
          status: "scheduled",
          scheduled_at: body.scheduled_at,
        })
        .select()
        .single();

      if (postError) {
        return safeJsonError("Failed to schedule post", 500, origin);
      }

      return safeJsonOk({ post }, origin, 201);
    }

    return safeJsonError("Unknown action", 400, origin);
  } catch (err) {
    console.error("meta-social error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
