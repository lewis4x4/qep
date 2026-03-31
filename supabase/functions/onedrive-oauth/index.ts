/**
 * OneDrive OAuth callback handler
 * Exchanges authorization code for access + refresh tokens
 * and stores them in onedrive_sync_state for the authenticated user.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptOneDriveToken } from "../_shared/integration-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_DRIVE_URL = "https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType,webUrl";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const mode = url.searchParams.get("mode");

  if (error) {
    return respondError(`OneDrive OAuth error: ${error}`, mode);
  }

  if (!code) {
    return respondError("No authorization code received", mode);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return respondError("Not authenticated", mode, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;
    if (authError || !user) {
      return respondError("Not authenticated", mode, 401);
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("MSGRAPH_CLIENT_ID")!,
        client_secret: Deno.env.get("MSGRAPH_CLIENT_SECRET")!,
        grant_type: "authorization_code",
        code,
        redirect_uri: Deno.env.get("MSGRAPH_REDIRECT_URI")!,
      }),
    });

    if (!tokenRes.ok) {
      const tokenError = await tokenRes.text();
      return respondError(`Token exchange failed: ${tokenError}`, mode, 400);
    }

    const tokens = await tokenRes.json();

    const driveRes = await fetch(GRAPH_DRIVE_URL, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!driveRes.ok) {
      const driveError = await driveRes.text();
      return respondError(`Failed to load drive info: ${driveError}`, mode, 400);
    }

    const drive = await driveRes.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const expiresIn = Number(tokens.expires_in ?? 3600);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { data: existingState } = await supabaseAdmin
      .from("onedrive_sync_state")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const payload = {
      user_id: user.id,
      drive_id: drive.id ?? null,
      access_token: await encryptOneDriveToken(tokens.access_token),
      refresh_token: tokens.refresh_token
        ? await encryptOneDriveToken(tokens.refresh_token)
        : null,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    };

    const operation = existingState
      ? supabaseAdmin.from("onedrive_sync_state").update(payload).eq("id", existingState.id)
      : supabaseAdmin.from("onedrive_sync_state").insert(payload);

    const { error: saveError } = await operation;
    if (saveError) {
      return respondError(`Failed to save connection: ${saveError.message}`, mode, 500);
    }

    return respondSuccess(
      {
        success: true,
        driveId: drive.id ?? null,
        driveType: drive.driveType ?? null,
        webUrl: drive.webUrl ?? null,
      },
      mode,
    );
  } catch (oauthError) {
    console.error("OneDrive OAuth error:", oauthError);
    return respondError("Internal error during OAuth flow", mode, 500);
  }
});

function respondSuccess(payload: Record<string, unknown>, mode: string | null): Response {
  if (mode === "json") {
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:5173";
  return Response.redirect(`${appUrl}/admin/integrations?onedrive=connected`, 302);
}

function respondError(message: string, mode: string | null, status = 400): Response {
  if (mode === "json") {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:5173";
  return Response.redirect(
    `${appUrl}/admin/integrations?onedrive=error&message=${encodeURIComponent(message)}`,
    302,
  );
}
