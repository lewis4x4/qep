import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptCredential } from "./integration-crypto.ts";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_HUBSPOT_SCOPES =
  "crm.objects.deals.read crm.objects.deals.write oauth";

interface IntegrationStatusCredentialRow {
  credentials_encrypted: string | null;
}

interface HubSpotCredentialPayload {
  client_id?: string;
  client_secret?: string;
  app_id?: string;
  redirect_uri?: string;
  scopes?: string;
}

export interface HubSpotRuntimeConfig {
  clientId: string;
  clientSecret: string;
  appId: string;
  redirectUri: string;
  scopes: string;
  source: "integration_status" | "env";
}

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDefaultRedirectUri(): string | null {
  const explicitRedirect = normalizeString(Deno.env.get("HUBSPOT_REDIRECT_URI"));
  if (explicitRedirect) return explicitRedirect;

  const supabaseUrl = normalizeString(Deno.env.get("SUPABASE_URL"));
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/functions/v1/hubspot-oauth`;
}

function parseCredentialPayload(raw: string): HubSpotCredentialPayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }
      return undefined;
    };

    return {
      client_id: pick("client_id", "clientId", "hubspot_client_id"),
      client_secret: pick(
        "client_secret",
        "clientSecret",
        "hubspot_client_secret",
      ),
      app_id: pick("app_id", "appId", "hubspot_app_id"),
      redirect_uri: pick("redirect_uri", "redirectUri", "hubspot_redirect_uri"),
      scopes: pick("scopes", "hubspot_scopes"),
    };
  } catch {
    return null;
  }
}

function resolveFromEnv(): HubSpotRuntimeConfig | null {
  const clientId = normalizeString(Deno.env.get("HUBSPOT_CLIENT_ID"));
  const clientSecret = normalizeString(Deno.env.get("HUBSPOT_CLIENT_SECRET"));
  const appId = normalizeString(Deno.env.get("HUBSPOT_APP_ID"));
  const redirectUri = resolveDefaultRedirectUri();
  const scopes =
    normalizeString(Deno.env.get("HUBSPOT_SCOPES")) ?? DEFAULT_HUBSPOT_SCOPES;

  if (!clientId || !clientSecret || !appId || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    appId,
    redirectUri,
    scopes,
    source: "env",
  };
}

export async function resolveHubSpotRuntimeConfig(
  supabase: SupabaseClient,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<HubSpotRuntimeConfig | null> {
  const fallbackFromEnv = resolveFromEnv();
  const resolvedWorkspaceId = normalizeString(workspaceId) ?? DEFAULT_WORKSPACE_ID;

  const { data: row, error } = await supabase
    .from("integration_status")
    .select("credentials_encrypted")
    .eq("workspace_id", resolvedWorkspaceId)
    .eq("integration_key", "hubspot")
    .maybeSingle<IntegrationStatusCredentialRow>();

  if (error) {
    console.error("[hubspot-config] failed to query integration_status", {
      workspaceId: resolvedWorkspaceId,
      code: error.code,
      message: error.message,
    });
    return fallbackFromEnv;
  }

  if (!row?.credentials_encrypted) {
    return fallbackFromEnv;
  }

  try {
    const decrypted = await decryptCredential(row.credentials_encrypted, "hubspot");
    const payload = parseCredentialPayload(decrypted);
    if (!payload) {
      console.warn("[hubspot-config] credentials payload is not valid JSON", {
        workspaceId: resolvedWorkspaceId,
      });
      return fallbackFromEnv;
    }

    const clientId = normalizeString(payload.client_id);
    const clientSecret = normalizeString(payload.client_secret);
    const appId = normalizeString(payload.app_id);
    const redirectUri =
      normalizeString(payload.redirect_uri) ?? resolveDefaultRedirectUri();
    const scopes = normalizeString(payload.scopes) ?? DEFAULT_HUBSPOT_SCOPES;

    if (!clientId || !clientSecret || !appId || !redirectUri) {
      console.warn("[hubspot-config] missing required fields in stored payload", {
        workspaceId: resolvedWorkspaceId,
      });
      return fallbackFromEnv;
    }

    return {
      clientId,
      clientSecret,
      appId,
      redirectUri,
      scopes,
      source: "integration_status",
    };
  } catch (decryptError) {
    console.error("[hubspot-config] failed to decrypt stored credentials", {
      workspaceId: resolvedWorkspaceId,
      error: decryptError instanceof Error
        ? decryptError.message
        : String(decryptError),
    });
    return fallbackFromEnv;
  }
}
