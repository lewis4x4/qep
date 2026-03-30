/**
 * HubSpot OAuth handler
 * - Initiates OAuth with signed state bound to the caller session
 * - Validates callback state on completion
 * - Exchanges code for tokens and stores encrypted connection secrets
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptToken } from "../_shared/hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "../_shared/hubspot-runtime-config.ts";
import {
  buildOAuthStateCookieHeader,
  clearOAuthStateCookieHeader,
  createOAuthStateRecord,
  createSignedOAuthStateCookie,
  hashSessionToken,
  readAndVerifyOAuthStateCookie,
  validateOAuthCallbackState,
} from "./oauth-state.ts";
import {
  redirectWithCorsHeaders,
  redirectWithOAuthError,
  registerWebhookSubscription,
} from "./oauth-utils.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const DEFAULT_HUBSPOT_SCOPES =
  "crm.objects.deals.read crm.objects.deals.write oauth";

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    console.warn("[hubspot-oauth] provider denied OAuth request", {
      providerError,
    });
    return redirectWithOAuthError("provider_denied", ch, {
      clearStateCookie: true,
    });
  }

  if (!code) {
    return initiateOAuthFlow(req, ch);
  }

  return completeOAuthCallback(req, code, url.searchParams.get("state"), ch);
});

async function initiateOAuthFlow(
  req: Request,
  ch: Record<string, string>,
): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  const stateSecret = Deno.env.get("HUBSPOT_OAUTH_STATE_SECRET");
  if (!stateSecret) {
    console.error(
      "[hubspot-oauth] HUBSPOT_OAUTH_STATE_SECRET is not configured",
    );
    return redirectWithOAuthError("state_secret_missing", ch, {
      clearStateCookie: true,
    });
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return redirectWithOAuthError("not_authenticated", ch, {
      clearStateCookie: true,
    });
  }

  const jwt = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return redirectWithOAuthError("not_authenticated", ch, {
        clearStateCookie: true,
      });
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const runtimeConfig = await resolveHubSpotRuntimeConfig(supabaseAdmin);
    if (!runtimeConfig) {
      console.error("[hubspot-oauth] runtime OAuth config is unavailable");
      return redirectWithOAuthError("state_secret_missing", ch, {
        clearStateCookie: true,
      });
    }

    const sessionBinding = await hashSessionToken(jwt);
    const stateRecord = createOAuthStateRecord(user.id, sessionBinding);
    const signedState = await createSignedOAuthStateCookie(
      stateRecord,
      stateSecret,
    );

    const authorizeUrl = new URL(HUBSPOT_AUTHORIZE_URL);
    authorizeUrl.searchParams.set(
      "client_id",
      runtimeConfig.clientId,
    );
    authorizeUrl.searchParams.set(
      "redirect_uri",
      runtimeConfig.redirectUri,
    );
    authorizeUrl.searchParams.set(
      "scope",
      runtimeConfig.scopes || DEFAULT_HUBSPOT_SCOPES,
    );
    authorizeUrl.searchParams.set("state", stateRecord.state);

    return redirectWithCorsHeaders(authorizeUrl.toString(), ch, {
      setCookie: buildOAuthStateCookieHeader(signedState),
    });
  } catch (err) {
    console.error("HubSpot OAuth init error:", err);
    return redirectWithOAuthError("internal_error", ch, {
      clearStateCookie: true,
    });
  }
}

async function completeOAuthCallback(
  req: Request,
  code: string,
  callbackState: string | null,
  ch: Record<string, string>,
): Promise<Response> {
  const stateSecret = Deno.env.get("HUBSPOT_OAUTH_STATE_SECRET");
  if (!stateSecret) {
    console.error(
      "[hubspot-oauth] HUBSPOT_OAUTH_STATE_SECRET is not configured",
    );
    return redirectWithOAuthError("state_secret_missing", ch, {
      clearStateCookie: true,
    });
  }

  const stateRecord = await readAndVerifyOAuthStateCookie(
    req.headers.get("cookie"),
    stateSecret,
  );
  const validation = validateOAuthCallbackState(callbackState, stateRecord);
  if (!validation.ok) {
    const reasonCode = validation.reasonCode === "state_mismatch"
      ? "state_mismatch"
      : validation.reasonCode === "state_missing"
      ? "state_missing"
      : "state_invalid";
    return redirectWithOAuthError(reasonCode, ch, { clearStateCookie: true });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const runtimeConfig = await resolveHubSpotRuntimeConfig(supabaseAdmin);
    if (!runtimeConfig) {
      console.error("[hubspot-oauth] runtime OAuth config is unavailable");
      return redirectWithOAuthError("state_secret_missing", ch, {
        clearStateCookie: true,
      });
    }

    // Exchange code for tokens.
    const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: runtimeConfig.clientId,
        client_secret: runtimeConfig.clientSecret,
        redirect_uri: runtimeConfig.redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const providerBody = await tokenRes.text();
      console.error("[hubspot-oauth] token exchange failed", {
        status: tokenRes.status,
        bodyPreview: providerBody.slice(0, 300),
      });
      return redirectWithOAuthError("token_exchange_failed", ch, {
        clearStateCookie: true,
      });
    }

    const tokens = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (
      typeof tokens.access_token !== "string" ||
      typeof tokens.refresh_token !== "string" ||
      typeof tokens.expires_in !== "number"
    ) {
      console.error(
        "[hubspot-oauth] token exchange payload missing required fields",
      );
      return redirectWithOAuthError("token_exchange_failed", ch, {
        clearStateCookie: true,
      });
    }

    // Get HubSpot portal info.
    const portalRes = await fetch(
      "https://api.hubapi.com/oauth/v1/access-tokens/" + tokens.access_token,
    );
    if (!portalRes.ok) {
      const providerBody = await portalRes.text();
      console.error("[hubspot-oauth] portal lookup failed", {
        status: portalRes.status,
        bodyPreview: providerBody.slice(0, 300),
      });
      return redirectWithOAuthError("portal_lookup_failed", ch, {
        clearStateCookie: true,
      });
    }
    const portalInfo = await portalRes.json() as {
      hub_id?: string | number;
      hub_domain?: string | null;
    };
    if (portalInfo.hub_id === undefined) {
      console.error("[hubspot-oauth] portal payload missing hub_id");
      return redirectWithOAuthError("portal_lookup_failed", ch, {
        clearStateCookie: true,
      });
    }

    // Encrypt tokens before storing — SEC-QEP-008.
    const [encAccessToken, encRefreshToken] = await Promise.all([
      encryptToken(tokens.access_token),
      encryptToken(tokens.refresh_token),
    ]);

    // Upsert connection
    const { error: upsertError } = await supabaseAdmin
      .from("hubspot_connections")
      .upsert({
        user_id: validation.userId,
        hub_id: String(portalInfo.hub_id),
        hub_domain: portalInfo.hub_domain ?? null,
        access_token: encAccessToken,
        refresh_token: encRefreshToken,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000)
          .toISOString(),
        scopes: tokens.scope?.split(" ") ?? [],
        is_active: true,
      }, { onConflict: "user_id,hub_id" });

    if (upsertError) {
      console.error("[hubspot-oauth] failed to save connection", {
        message: upsertError.message,
      });
      return redirectWithOAuthError("save_failed", ch, {
        clearStateCookie: true,
      });
    }

    // Register HubSpot webhook subscription for deal stage changes.
    await registerWebhookSubscription(tokens.access_token, runtimeConfig.appId);

    const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
    return redirectWithCorsHeaders(`${appUrl}/admin?hubspot=connected`, ch, {
      setCookie: clearOAuthStateCookieHeader(),
    });
  } catch (err) {
    console.error("OAuth error:", err);
    return redirectWithOAuthError("internal_error", ch, {
      clearStateCookie: true,
    });
  }
}
