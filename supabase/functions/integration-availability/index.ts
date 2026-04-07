import { createClient } from "jsr:@supabase/supabase-js@2";
import { fail, ok, optionsResponse, readJsonObject } from "../_shared/dge-http.ts";
import type { IntegrationStatusEnum } from "../_shared/integration-types.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface AvailabilityRequestBody {
  integration_key?: string;
}

interface ProfileRow {
  role: "rep" | "admin" | "manager" | "owner" | null;
}

interface IntegrationStatusRow {
  workspace_id: string;
  status: IntegrationStatusEnum;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  userClient: ReturnType<typeof createUserClient>
): Promise<string> {
  const { data, error } = await userClient.rpc("get_my_workspace");
  if (error || typeof data !== "string" || data.trim().length === 0) {
    throw new Error("WORKSPACE_RESOLUTION_FAILED");
  }
  return data.trim();
}

function isSupportedIntegrationKey(key: string): boolean {
  return key === "intellidealer" || key === "sendgrid" || key === "twilio";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for integration availability checks.",
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
    const body = await readJsonObject<AvailabilityRequestBody>(req);
    const integrationKey = body.integration_key?.trim().toLowerCase();

    if (!integrationKey || !isSupportedIntegrationKey(integrationKey)) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_REQUEST",
        message: "integration_key must be one of: intellidealer, sendgrid, twilio.",
      });
    }

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
      .select("role")
      .eq("id", userId)
      .single<ProfileRow>();

    if (profileError || !profile?.role) {
      return fail({
        origin,
        status: 403,
        code: "FORBIDDEN",
        message: "Profile role required for integration availability checks.",
      });
    }

    const workspaceId = await resolveWorkspaceId(userClient);

    const { data: scopedRow, error: scopedError } = await adminClient
      .from("integration_status")
      .select("workspace_id, status")
      .eq("workspace_id", workspaceId)
      .eq("integration_key", integrationKey)
      .maybeSingle<IntegrationStatusRow>();

    if (scopedError) {
      return fail({
        origin,
        status: 500,
        code: "INTEGRATION_STATUS_QUERY_FAILED",
        message: "Unable to read integration status.",
      });
    }

    const resolvedRow = scopedRow;
    const status = resolvedRow?.status ?? "pending_credentials";

    return ok(
      {
        integration_key: integrationKey,
        workspace_id: workspaceId,
        status,
        connected: status === "connected",
      },
      { origin }
    );
  } catch (error) {
    captureEdgeException(error, { fn: "integration-availability", req });
    if (error instanceof Error && error.message === "WORKSPACE_RESOLUTION_FAILED") {
      return fail({
        origin,
        status: 500,
        code: "WORKSPACE_RESOLUTION_FAILED",
        message: "Could not resolve workspace context for this request.",
      });
    }

    console.error("[integration-availability] error:", error instanceof Error ? error.message : error);
    return fail({
      origin,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Integration availability check failed.",
    });
  }
});
