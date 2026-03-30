import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptToken, encryptToken } from "./hubspot-crypto.ts";
import { resolveHubSpotRuntimeConfig } from "./hubspot-runtime-config.ts";
import { resilientFetch } from "./resilient-fetch.ts";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_TOKEN_URL = `${HUBSPOT_BASE_URL}/oauth/v1/token`;
const REFRESH_BUFFER_MS = 60_000;

interface WorkspaceHubSpotPortalRow {
  workspace_id: string;
  hub_id: string;
  connection_id: string;
}

interface HubSpotConnectionRow {
  id: string;
  hub_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface HubSpotCanonicalContext {
  workspaceId: string;
  hubId: string;
  connection: HubSpotConnectionRow;
}

export type HubSpotCanonicalResolutionCode =
  | "ok"
  | "binding_query_failed"
  | "no_active_binding"
  | "ambiguous_active_binding"
  | "connection_query_failed"
  | "connection_missing_or_inactive"
  | "connection_hub_mismatch";

export interface HubSpotCanonicalResolution {
  code: HubSpotCanonicalResolutionCode;
  context: HubSpotCanonicalContext | null;
}

export async function resolveCanonicalHubSpotContext(
  supabase: SupabaseClient,
  hubId: string,
): Promise<HubSpotCanonicalContext | null> {
  const resolution = await resolveCanonicalHubSpotResolution(supabase, hubId);
  return resolution.context;
}

export async function resolveCanonicalHubSpotResolution(
  supabase: SupabaseClient,
  hubId: string,
): Promise<HubSpotCanonicalResolution> {
  const { data: bindings, error: bindingError } = await supabase
    .from("workspace_hubspot_portal")
    .select("workspace_id, hub_id, connection_id")
    .eq("hub_id", hubId)
    .eq("is_active", true)
    .limit(2);

  if (bindingError) {
    console.error("[hubspot] failed to query workspace_hubspot_portal", {
      hubId,
      code: bindingError.code,
      message: bindingError.message,
    });
    return { code: "binding_query_failed", context: null };
  }

  const bindingRows = (bindings ?? []) as WorkspaceHubSpotPortalRow[];
  if (bindingRows.length === 0) {
    console.warn("[hubspot] no active canonical portal binding", { hubId });
    return { code: "no_active_binding", context: null };
  }

  if (bindingRows.length > 1) {
    console.error("[hubspot] ambiguous active portal bindings found", {
      hubId,
      workspaceIds: bindingRows.map((row) => row.workspace_id),
      connectionIds: bindingRows.map((row) => row.connection_id),
    });
    return { code: "ambiguous_active_binding", context: null };
  }

  const binding = bindingRows[0];

  const { data: connections, error: connectionError } = await supabase
    .from("hubspot_connections")
    .select("id, hub_id, access_token, refresh_token, token_expires_at")
    .eq("id", binding.connection_id)
    .eq("is_active", true)
    .limit(1);

  if (connectionError) {
    console.error("[hubspot] failed to load canonical connection", {
      hubId,
      connectionId: binding.connection_id,
      code: connectionError.code,
      message: connectionError.message,
    });
    return { code: "connection_query_failed", context: null };
  }

  const connectionRows = (connections ?? []) as HubSpotConnectionRow[];
  if (connectionRows.length === 0) {
    console.warn("[hubspot] canonical connection is missing or inactive", {
      hubId,
      workspaceId: binding.workspace_id,
      connectionId: binding.connection_id,
    });
    return { code: "connection_missing_or_inactive", context: null };
  }

  const connection = connectionRows[0];
  if (connection.hub_id !== hubId) {
    console.warn("[hubspot] canonical connection hub mismatch", {
      expectedHubId: hubId,
      actualHubId: connection.hub_id,
      workspaceId: binding.workspace_id,
      connectionId: connection.id,
    });
    return { code: "connection_hub_mismatch", context: null };
  }

  return {
    code: "ok",
    context: {
      workspaceId: binding.workspace_id,
      hubId,
      connection,
    },
  };
}

export async function getValidHubSpotAccessToken(
  supabase: SupabaseClient,
  context: HubSpotCanonicalContext,
): Promise<string | null> {
  try {
    const [plainAccessToken, plainRefreshToken] = await Promise.all([
      decryptToken(context.connection.access_token),
      decryptToken(context.connection.refresh_token),
    ]);

    const expiresAtMs = new Date(context.connection.token_expires_at).getTime();
    if (
      !Number.isNaN(expiresAtMs) &&
      Date.now() < (expiresAtMs - REFRESH_BUFFER_MS)
    ) {
      return plainAccessToken;
    }

    const runtimeConfig = await resolveHubSpotRuntimeConfig(
      supabase,
      context.workspaceId,
    );
    if (!runtimeConfig) {
      console.error("[hubspot] runtime OAuth config missing", {
        workspaceId: context.workspaceId,
        hubId: context.hubId,
      });
      return null;
    }

    const refreshPayload = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: runtimeConfig.clientId,
      client_secret: runtimeConfig.clientSecret,
      refresh_token: plainRefreshToken,
    });

    const { response } = await resilientFetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshPayload,
      integrationKey: "hubspot",
      operationKey: `${context.hubId}:token_refresh`,
    });

    const tokens = await response.json() as Partial<HubSpotTokenResponse>;
    if (!tokens.access_token || typeof tokens.expires_in !== "number") {
      console.error("[hubspot] token refresh returned malformed payload", {
        hubId: context.hubId,
        connectionId: context.connection.id,
      });
      return null;
    }

    const nextRefreshToken = typeof tokens.refresh_token === "string" &&
        tokens.refresh_token.length > 0
      ? tokens.refresh_token
      : plainRefreshToken;

    const [encAccess, encRefresh] = await Promise.all([
      encryptToken(tokens.access_token),
      encryptToken(nextRefreshToken),
    ]);

    const nextExpiresAt = new Date(Date.now() + tokens.expires_in * 1000)
      .toISOString();

    const { error: updateError } = await supabase
      .from("hubspot_connections")
      .update({
        access_token: encAccess,
        refresh_token: encRefresh,
        token_expires_at: nextExpiresAt,
      })
      .eq("id", context.connection.id);

    if (updateError) {
      console.error("[hubspot] failed to persist refreshed token", {
        hubId: context.hubId,
        connectionId: context.connection.id,
        code: updateError.code,
        message: updateError.message,
      });
      return null;
    }

    context.connection.access_token = encAccess;
    context.connection.refresh_token = encRefresh;
    context.connection.token_expires_at = nextExpiresAt;

    return tokens.access_token;
  } catch (error) {
    console.error("[hubspot] failed to get valid access token", {
      hubId: context.hubId,
      connectionId: context.connection.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface HubSpotRequestOptions {
  hubId: string;
  operationKey: string;
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH";
  body?: string;
}

export async function requestHubSpot(
  options: HubSpotRequestOptions,
): Promise<Response> {
  const { hubId, operationKey, token, path, method = "GET", body } = options;
  const url = path.startsWith("http") ? path : `${HUBSPOT_BASE_URL}${path}`;

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  });

  if (body) {
    headers.set("Content-Type", "application/json");
  }

  const { response } = await resilientFetch(url, {
    method,
    headers,
    body,
    integrationKey: "hubspot",
    operationKey: `${hubId}:${operationKey}`,
  });

  return response;
}
