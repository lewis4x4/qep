/**
 * HubSpot OAuth callback handler
 * Exchanges authorization code for access + refresh tokens
 * and stores them in hubspot_connections
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return redirectWithError(`HubSpot OAuth error: ${error}`);
  }

  if (!code) {
    return redirectWithError("No authorization code received");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return redirectWithError("Not authenticated");
    }

    // Exchange code for tokens
    const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: Deno.env.get("HUBSPOT_CLIENT_ID")!,
        client_secret: Deno.env.get("HUBSPOT_CLIENT_SECRET")!,
        redirect_uri: Deno.env.get("HUBSPOT_REDIRECT_URI")!,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return redirectWithError(`Token exchange failed: ${err}`);
    }

    const tokens = await tokenRes.json();

    // Get HubSpot portal info
    const portalRes = await fetch("https://api.hubapi.com/oauth/v1/access-tokens/" + tokens.access_token);
    const portalInfo = await portalRes.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Upsert connection
    const { error: upsertError } = await supabaseAdmin
      .from("hubspot_connections")
      .upsert({
        user_id: user.id,
        hub_id: String(portalInfo.hub_id),
        hub_domain: portalInfo.hub_domain,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes: tokens.scope?.split(" ") ?? [],
        is_active: true,
      }, { onConflict: "user_id,hub_id" });

    if (upsertError) {
      return redirectWithError(`Failed to save connection: ${upsertError.message}`);
    }

    // Register HubSpot webhook subscription for deal stage changes
    await registerWebhookSubscription(tokens.access_token, portalInfo.hub_id);

    // Redirect back to admin page
    const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
    return Response.redirect(`${appUrl}/admin?hubspot=connected`, 302);

  } catch (err) {
    console.error("OAuth error:", err);
    return redirectWithError("Internal error during OAuth flow");
  }
});

async function registerWebhookSubscription(accessToken: string, appId: string) {
  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/hubspot-webhook`;

  // Check existing subscriptions
  const listRes = await fetch(
    `https://api.hubapi.com/webhooks/v3/${Deno.env.get("HUBSPOT_APP_ID")}/subscriptions`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const existing = await listRes.json();
  const alreadySubscribed = existing.results?.some(
    (s: { eventType: string; active: boolean }) =>
      s.eventType === "deal.propertyChange" && s.active
  );

  if (!alreadySubscribed) {
    await fetch(
      `https://api.hubapi.com/webhooks/v3/${Deno.env.get("HUBSPOT_APP_ID")}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType: "deal.propertyChange",
          propertyName: "dealstage",
          active: true,
        }),
      }
    );
  }
}

function redirectWithError(message: string): Response {
  const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
  return Response.redirect(
    `${appUrl}/admin?hubspot=error&message=${encodeURIComponent(message)}`,
    302
  );
}
