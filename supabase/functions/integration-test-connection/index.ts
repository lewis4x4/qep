import { createClient } from "jsr:@supabase/supabase-js@2";
import { AempMockAdapter } from "../_shared/adapters/aemp-mock.ts";
import { AuctionDataMockAdapter } from "../_shared/adapters/auction-data-mock.ts";
import { FinancingMockAdapter } from "../_shared/adapters/financing-mock.ts";
import { FredUsdaLiveAdapter } from "../_shared/adapters/fred-usda-live.ts";
import { FredUsdaMockAdapter } from "../_shared/adapters/fred-usda-mock.ts";
import { IntelliDealerMockAdapter } from "../_shared/adapters/intellidealer-mock.ts";
import { IronGuidesMockAdapter } from "../_shared/adapters/ironguides-mock.ts";
import { ManufacturerIncentivesMockAdapter } from "../_shared/adapters/manufacturer-incentives-mock.ts";
import { RouseMockAdapter } from "../_shared/adapters/rouse-mock.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";
import { fail, ok, optionsResponse, readJsonObject } from "../_shared/dge-http.ts";
import { createEventTracker } from "../_shared/event-tracker.ts";
import { decryptCredential, decryptOneDriveToken } from "../_shared/integration-crypto.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import type {
  AdapterConfig,
  IntegrationAdapter,
  IntegrationKey,
  IntegrationStatusEnum,
} from "../_shared/integration-types.ts";

interface TestConnectionBody {
  integration_key?: string;
}

interface ProfileRow {
  id: string;
  role: "rep" | "admin" | "manager" | "owner";
}

interface IntegrationStatusRow {
  integration_key: string;
  workspace_id: string;
  status: IntegrationStatusEnum;
  credentials_encrypted: string | null;
  endpoint_url: string | null;
  config: Record<string, unknown> | null;
}

type CommunicationIntegrationKey = "sendgrid" | "twilio";
type DeferredIntegrationKey =
  | "avatax"
  | "vesign"
  | "ups_worldship"
  | "jd_quote_ii"
  | "oem_base_options_imports"
  | "tethr_telematics";
type SupportedIntegrationKey = IntegrationKey | "hubspot" | "onedrive" | CommunicationIntegrationKey | DeferredIntegrationKey;

type TestConnectionResult = {
  success: boolean;
  latencyMs: number;
  error?: string;
};

type TestConnectionMode = "live" | "mock";

const REPLACED_INTEGRATIONS = new Set<SupportedIntegrationKey>([
  "hubspot",
  "intellidealer",
]);

const DEFERRED_PROVIDER_KEYS = new Set<SupportedIntegrationKey>([
  "avatax",
  "vesign",
  "ups_worldship",
  "jd_quote_ii",
  "oem_base_options_imports",
  "tethr_telematics",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MOCK_ADAPTERS: Record<IntegrationKey, IntegrationAdapter<unknown, unknown>> = {
  intellidealer: new IntelliDealerMockAdapter(),
  ironguides: new IronGuidesMockAdapter(),
  rouse: new RouseMockAdapter(),
  aemp: new AempMockAdapter(),
  financing: new FinancingMockAdapter(),
  manufacturer_incentives: new ManufacturerIncentivesMockAdapter(),
  auction_data: new AuctionDataMockAdapter(),
  fred_usda: new FredUsdaMockAdapter(),
};

const LIVE_ADAPTERS: Partial<Record<IntegrationKey, IntegrationAdapter<unknown, unknown>>> = {
  fred_usda: new FredUsdaLiveAdapter(),
};

function createUserClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolveWorkspaceId(
  userClient: ReturnType<typeof createUserClient>,
): Promise<string> {
  const { data, error } = await userClient.rpc("get_my_workspace");
  if (error || typeof data !== "string" || data.trim().length === 0) {
    throw new Error("WORKSPACE_RESOLUTION_FAILED");
  }
  return data.trim();
}

function parseCredentials(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        output[key] = value;
      }
    }
    return Object.keys(output).length > 0 ? output : { raw };
  } catch {
    return { raw };
  }
}

function hasFredCredentials(config: AdapterConfig): boolean {
  const creds = config.credentials ?? {};
  if (Deno.env.get("FRED_API_KEY")?.trim()) return true;
  return Boolean(creds.api_key || creds.fred_api_key || creds.key || creds.raw);
}

function shouldUseLiveAdapter(
  key: IntegrationKey,
  status: IntegrationStatusEnum,
  config: AdapterConfig,
): boolean {
  if (status !== "connected") return false;
  const liveAdapter = LIVE_ADAPTERS[key];
  if (!liveAdapter) return false;

  if (key === "fred_usda") {
    return hasFredCredentials(config);
  }

  return true;
}

function resolveIntegrationKey(raw: string | undefined): SupportedIntegrationKey | null {
  if (!raw) return null;
  switch (raw) {
    case "hubspot":
    case "sendgrid":
    case "twilio":
    case "onedrive":
    case "intellidealer":
    case "ironguides":
    case "rouse":
    case "aemp":
    case "financing":
    case "manufacturer_incentives":
    case "auction_data":
    case "fred_usda":
    case "avatax":
    case "vesign":
    case "ups_worldship":
    case "jd_quote_ii":
    case "oem_base_options_imports":
    case "tethr_telematics":
      return raw;
    default:
      return null;
  }
}

function isAdapterIntegrationKey(key: SupportedIntegrationKey): key is IntegrationKey {
  return key in MOCK_ADAPTERS;
}

function pickCredential(
  credentials: Record<string, string> | undefined,
  keys: string[],
): string | null {
  if (!credentials) return null;
  for (const key of keys) {
    const value = credentials[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

async function testSendGridConnection(
  credentials: Record<string, string> | undefined,
  endpointUrl: string | null,
): Promise<TestConnectionResult> {
  const apiKey = pickCredential(credentials, ["api_key", "sendgrid_api_key", "token", "raw"]);
  if (!apiKey) {
    return {
      success: false,
      latencyMs: 0,
      error: "SendGrid API key is required.",
    };
  }

  const baseUrl = endpointUrl?.trim() || "https://api.sendgrid.com";
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/v3/user/account`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        error: `SendGrid test failed (${response.status}).`,
      };
    }

    return {
      success: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      success: false,
      latencyMs: Date.now() - startedAt,
      error: "SendGrid test request failed.",
    };
  }
}

async function testTwilioConnection(
  credentials: Record<string, string> | undefined,
  endpointUrl: string | null,
): Promise<TestConnectionResult> {
  const accountSid = pickCredential(credentials, ["account_sid", "sid"]);
  const authToken = pickCredential(credentials, ["auth_token", "token"]);
  if (!accountSid || !authToken) {
    return {
      success: false,
      latencyMs: 0,
      error: "Twilio account SID and auth token are required.",
    };
  }

  const baseUrl = endpointUrl?.trim() || "https://api.twilio.com";
  const startedAt = Date.now();
  try {
    const basicAuth = btoa(`${accountSid}:${authToken}`);
    const response = await fetch(
      `${baseUrl}/2010-04-01/Accounts/${accountSid}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${basicAuth}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      return {
        success: false,
        latencyMs: Date.now() - startedAt,
        error: `Twilio test failed (${response.status}).`,
      };
    }

    return {
      success: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      success: false,
      latencyMs: Date.now() - startedAt,
      error: "Twilio test request failed.",
    };
  }
}

function resolveNextStatus(params: {
  previousStatus: IntegrationStatusEnum;
  mode: TestConnectionMode;
  success: boolean;
  hasCredentials: boolean;
}): IntegrationStatusEnum {
  if (params.success) {
    return params.mode === "live" ? "connected" : "demo_mode";
  }

  if (!params.hasCredentials) {
    return "pending_credentials";
  }

  return "error";
}

function resolveErrorCode(params: {
  hasCredentials: boolean;
  key: SupportedIntegrationKey;
  error?: string;
}): string {
  if (!params.hasCredentials) return "MISSING_CREDENTIALS";
  if (params.key === "hubspot" && params.error?.toLowerCase().includes("not configured")) {
    return "HUBSPOT_NOT_CONNECTED";
  }
  return "UPSTREAM_ERROR";
}

function hasConfiguredReplacementMetadata(config: Record<string, unknown> | null): boolean {
  return config?.lifecycle === "replaced" &&
    config.external_dependency_required === false &&
    typeof config.replacement_surface === "string" &&
    config.replacement_surface.trim().length > 0;
}

Deno.serve(async (req): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for integration test connection requests.",
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return fail({
      origin,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Missing bearer token.",
    });
  }

  const jwt = authHeader.replace("Bearer ", "").trim();
  const userClient = createUserClient(jwt);
  const adminClient = createAdminClient();

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const userId = authData.user?.id ?? null;
    if (authError || !userId) {
      return fail({
        origin,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Invalid authentication token.",
      });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .single<ProfileRow>();

    if (profileError || !profile || !["admin", "owner"].includes(profile.role)) {
      return fail({
        origin,
        status: 403,
        code: "FORBIDDEN",
        message: "Only admins and owners can test integrations.",
      });
    }

    const workspaceId = await resolveWorkspaceId(userClient);

    const rate = checkRateLimit({
      key: `integration-test-connection:${userId}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return fail({
        origin,
        status: 429,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: { retry_after_seconds: rate.retryAfterSeconds },
      });
    }

    const body = await readJsonObject<TestConnectionBody>(req);
    const integrationKey = resolveIntegrationKey(body.integration_key);
    if (!integrationKey) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_REQUEST",
        message: "integration_key is required and must be supported.",
      });
    }

    if (integrationKey === "onedrive") {
      const startedAt = Date.now();
      const { data: syncState, error: syncStateError } = await userClient
        .from("onedrive_sync_state")
        .select("access_token, token_expires_at")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle<{ access_token: string | null; token_expires_at: string | null }>();

      if (syncStateError) {
        return fail({
          origin,
          status: 500,
          code: "ONEDRIVE_STATE_LOAD_FAILED",
          message: "Could not load OneDrive connection state.",
        });
      }

      if (!syncState?.access_token) {
        return ok(
          {
            success: false,
            latencyMs: 0,
            mode: "live",
            error: {
              code: "ONEDRIVE_NOT_CONNECTED",
              message: "OneDrive is not connected for this account.",
            },
          },
          { origin },
        );
      }

      let accessToken: string;
      try {
        accessToken = await decryptOneDriveToken(syncState.access_token);
      } catch {
        return ok(
          {
            success: false,
            latencyMs: 0,
            mode: "live",
            error: {
              code: "ONEDRIVE_REAUTH_REQUIRED",
              message: "OneDrive authorization must be renewed before testing or sync.",
            },
          },
          { origin },
        );
      }

      try {
        const response = await fetch(
          "https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (!response.ok) {
          return ok(
            {
              success: false,
              latencyMs: Date.now() - startedAt,
              mode: "live",
              error: {
                code: response.status === 401
                  ? "ONEDRIVE_REAUTH_REQUIRED"
                  : "ONEDRIVE_UPSTREAM_ERROR",
                message: response.status === 401
                  ? "Microsoft rejected the stored token. Reconnect OneDrive."
                  : `Microsoft Graph test failed (${response.status}).`,
              },
            },
            { origin },
          );
        }

        return ok(
          {
            success: true,
            latencyMs: Date.now() - startedAt,
            mode: "live",
          },
          { origin },
        );
      } catch {
        return ok(
          {
            success: false,
            latencyMs: Date.now() - startedAt,
            mode: "live",
            error: {
              code: "ONEDRIVE_REQUEST_FAILED",
              message: "OneDrive test request failed.",
            },
          },
          { origin },
        );
      }
    }

    const { data: statusRow, error: statusError } = await userClient
      .from("integration_status")
      .select("integration_key, workspace_id, status, credentials_encrypted, endpoint_url, config")
      .eq("workspace_id", workspaceId)
      .eq("integration_key", integrationKey)
      .maybeSingle<IntegrationStatusRow>();

    if (statusError || !statusRow) {
      return fail({
        origin,
        status: 404,
        code: "INTEGRATION_NOT_FOUND",
        message: "Integration is not configured for your workspace.",
      });
    }

    if (
      REPLACED_INTEGRATIONS.has(integrationKey) ||
      hasConfiguredReplacementMetadata(statusRow.config)
    ) {
      return ok(
        {
          success: true,
          latencyMs: 0,
          mode: "mock",
          replacement: true,
        },
        { origin },
      );
    }

    if (
      DEFERRED_PROVIDER_KEYS.has(integrationKey) ||
      statusRow.config?.provider_scope === "wave_5_deferred_external" ||
      statusRow.config?.provider_scope === "parity_external_decision" ||
      statusRow.config?.implementation_status === "deferred" ||
      statusRow.config?.implementation_status === "decision_required" ||
      statusRow.config?.decision_required === true
    ) {
      return ok(
        {
          success: false,
          latencyMs: 0,
          mode: "mock",
          error: {
            code: "DEFERRED_PROVIDER_TEST_DISABLED",
            message:
              "This provider is registered for readiness or decision tracking only. Add an approved live provider contract, adapter/feed test path, credentials policy, and cutover test plan before testing.",
          },
        },
        { origin },
      );
    }

    const tracker = createEventTracker(adminClient, {
      workspaceId,
    });

    const testedAt = new Date().toISOString();
    const previousStatus = statusRow.status;

    let result: TestConnectionResult;
    let mode: TestConnectionMode = "mock";
    const hasCredentials = Boolean(statusRow.credentials_encrypted);

    if (integrationKey === "hubspot") {
      const startedAt = Date.now();
      const { data: portalRows, error: portalError } = await userClient
        .from("workspace_hubspot_portal")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .limit(1);

      if (portalError) {
        result = {
          success: false,
          latencyMs: Date.now() - startedAt,
          error: "Unable to verify HubSpot connection.",
        };
      } else {
        const connected = (portalRows?.length ?? 0) > 0;
        result = connected
          ? { success: true, latencyMs: Date.now() - startedAt }
          : {
            success: false,
            latencyMs: Date.now() - startedAt,
            error: "HubSpot is not configured for this workspace.",
          };
      }

      mode = result.success ? "live" : "mock";
    } else if (integrationKey === "sendgrid" || integrationKey === "twilio") {
      if (!statusRow.credentials_encrypted) {
        result = {
          success: false,
          latencyMs: 0,
          error: `No credentials configured for ${integrationKey}.`,
        };
      } else {
        const decrypted = await decryptCredential(
          statusRow.credentials_encrypted,
          integrationKey,
        );
        const credentials = parseCredentials(decrypted);

        result = integrationKey === "sendgrid"
          ? await testSendGridConnection(credentials, statusRow.endpoint_url)
          : await testTwilioConnection(credentials, statusRow.endpoint_url);
      }

      mode = "live";
    } else {
      if (!isAdapterIntegrationKey(integrationKey)) {
        return fail({
          origin,
          status: 400,
          code: "INTEGRATION_NOT_TESTABLE",
          message: "No connection-test adapter exists for this integration.",
        });
      }

      if (!statusRow.credentials_encrypted) {
        result = {
          success: false,
          latencyMs: 0,
          error: "No credentials configured. Add API credentials before testing.",
        };
      } else {
        const decrypted = await decryptCredential(
          statusRow.credentials_encrypted,
          integrationKey,
        );

        const adapterConfig: AdapterConfig = {
          credentials: parseCredentials(decrypted),
          endpointUrl: statusRow.endpoint_url ?? undefined,
          config: statusRow.config ?? {},
        };

        const adapter = shouldUseLiveAdapter(integrationKey, statusRow.status, adapterConfig)
          ? LIVE_ADAPTERS[integrationKey]!
          : MOCK_ADAPTERS[integrationKey];

        result = await adapter.testConnection(adapterConfig);
        mode = adapter.isMock ? "mock" : "live";
      }
    }

    const nextStatus = resolveNextStatus({
      previousStatus,
      mode,
      success: result.success,
      hasCredentials,
    });

    const updatePayload = {
      last_test_at: testedAt,
      last_test_success: result.success,
      last_test_latency_ms: result.success ? result.latencyMs : null,
      last_test_error: result.success ? null : result.error ?? "Connection test failed",
      status: nextStatus,
      updated_at: testedAt,
    };

    const { error: updateError } = await userClient
      .from("integration_status")
      .update(updatePayload)
      .eq("workspace_id", workspaceId)
      .eq("integration_key", integrationKey);

    if (updateError) {
      return fail({
        origin,
        status: 500,
        code: "UPDATE_FAILED",
        message: "Failed to record test result.",
      });
    }

    const errorCode = result.success ? null : resolveErrorCode({
      hasCredentials,
      key: integrationKey,
      error: result.error,
    });

    await tracker.trackEvent({
      event_name: "integration_test_connection_result",
      user_id: userId,
      role: profile.role,
      source: "edge",
      entity_type: "integration",
      entity_id: integrationKey,
      properties: {
        integration_key: integrationKey,
        success: result.success,
        latency_ms: result.latencyMs,
        mode,
        error_code: errorCode,
      },
    });

    if (previousStatus !== nextStatus) {
      await tracker.trackEvent({
        event_name: "integration_status_changed",
        user_id: userId,
        role: profile.role,
        source: "edge",
        entity_type: "integration",
        entity_id: integrationKey,
        properties: {
          integration_key: integrationKey,
          status_before: previousStatus,
          status_after: nextStatus,
          reason: result.success ? "test_connection_success" : "test_connection_failure",
        },
      });
    }

    if (nextStatus === "demo_mode" && previousStatus !== "demo_mode") {
      await tracker.trackEvent({
        event_name: "integration_fallback_activated",
        user_id: userId,
        role: profile.role,
        source: "edge",
        entity_type: "integration",
        entity_id: integrationKey,
        properties: {
          integration_key: integrationKey,
          reason: result.success
            ? "mock_adapter_active"
            : errorCode ?? "test_connection_failure",
          surface: "admin_integrations",
        },
      });
    }

    if (previousStatus === "demo_mode" && nextStatus === "connected") {
      await tracker.trackEvent({
        event_name: "integration_fallback_cleared",
        user_id: userId,
        role: profile.role,
        source: "edge",
        entity_type: "integration",
        entity_id: integrationKey,
        properties: {
          integration_key: integrationKey,
          surface: "admin_integrations",
        },
      });
    }

    if (result.success) {
      return ok(
        { success: true, latencyMs: result.latencyMs, mode },
        { origin },
      );
    }

    return ok(
      {
        success: false,
        latencyMs: result.latencyMs,
        mode,
        error: {
          code: errorCode,
          message: result.error ?? "Connection test failed.",
        },
      },
      { origin },
    );
  } catch (error) {
    captureEdgeException(error, { fn: "integration-test-connection", req });
    if (error instanceof Error && error.message === "WORKSPACE_RESOLUTION_FAILED") {
      return fail({
        origin,
        status: 500,
        code: "WORKSPACE_RESOLUTION_FAILED",
        message: "Could not resolve workspace context for this request.",
      });
    }

    if (error instanceof SyntaxError) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      });
    }

    return fail({
      origin,
      status: 500,
      code: "UNEXPECTED_ERROR",
      message: "Unexpected integration test failure.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
