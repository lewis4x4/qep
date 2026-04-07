import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  emitCrmAccessDeniedAudit,
  extractRequestIp,
} from "../_shared/crm-auth-audit.ts";
import { errorResponse, jsonResponse } from "../_shared/crm-error.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { loadCrmHubspotImportEnv } from "./env.ts";
import { runHubSpotImport } from "./import-runner.ts";
import { loadOrCreateImportState, updateRun } from "./run-state.ts";
import type { ImportRequestBody, UserRole } from "./types.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

const {
  supabaseUrl: SUPABASE_URL,
  supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  supabaseAnonKey: SUPABASE_ANON_KEY,
} = loadCrmHubspotImportEnv(Deno.env);

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const ch = corsHeaders(req.headers.get("origin"));
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }
  if (req.method !== "POST") {
    return errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "Use POST for QRM HubSpot import.",
      {
        headers: ch,
      },
    );
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    await emitCrmAccessDeniedAudit(supabaseAdmin, {
      workspaceId: "default",
      requestId,
      resource: "/functions/v1/crm-hubspot-import",
      reasonCode: "missing_authorization_header",
      ipInet: extractRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });

    return errorResponse(401, "UNAUTHORIZED", "Missing authorization header.", {
      headers: ch,
    });
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await callerClient.auth
    .getUser();
  if (authError || !authData.user) {
    await emitCrmAccessDeniedAudit(supabaseAdmin, {
      workspaceId: "default",
      requestId,
      resource: "/functions/v1/crm-hubspot-import",
      reasonCode: "invalid_bearer_or_unresolved_user",
      ipInet: extractRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      metadata: {
        auth_error_code: authError?.code ?? null,
        has_user: Boolean(authData.user),
      },
    });
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "Unable to resolve caller identity.",
      {
        headers: ch,
        details: { requestId },
      },
    );
  }

  const { data: callerWorkspaceData, error: callerWorkspaceError } =
    await callerClient.rpc("get_my_workspace");
  const callerWorkspaceId = typeof callerWorkspaceData === "string" &&
      callerWorkspaceData.length > 0
    ? callerWorkspaceData
    : null;

  if (callerWorkspaceError || !callerWorkspaceId) {
    return errorResponse(
      500,
      "WORKSPACE_RESOLUTION_FAILED",
      "Unable to resolve caller workspace.",
      {
        headers: ch,
        details: {
          requestId,
          message: callerWorkspaceError?.message ?? "workspace_not_resolved",
        },
      },
    );
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle<{ role: UserRole | null }>();

  if (!profile || (profile.role !== "admin" && profile.role !== "owner")) {
    await emitCrmAccessDeniedAudit(supabaseAdmin, {
      workspaceId: callerWorkspaceId,
      requestId,
      resource: "/functions/v1/crm-hubspot-import",
      reasonCode: "insufficient_role",
      actorUserId: authData.user.id,
      ipInet: extractRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      metadata: {
        required_roles: ["admin", "owner"],
        caller_role: profile?.role ?? null,
      },
    });

    return errorResponse(
      403,
      "FORBIDDEN",
      "Only admin/owner can run QRM import.",
      {
        headers: ch,
      },
    );
  }

  let body: ImportRequestBody = {};
  try {
    const rawBody = await req.text();
    body = rawBody.trim().length === 0
      ? {}
      : JSON.parse(rawBody) as ImportRequestBody;
  } catch {
    return errorResponse(
      400,
      "INVALID_JSON",
      "Request body must be valid JSON.",
      {
        headers: ch,
      },
    );
  }

  let state;
  try {
    state = await loadOrCreateImportState(
      supabaseAdmin,
      body.runId,
      authData.user.id,
      callerWorkspaceId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message === "RUN_NOT_FOUND") {
      return errorResponse(404, "RUN_NOT_FOUND", "Import run not found.", {
        headers: ch,
      });
    }

    if (message === "RUN_WORKSPACE_FORBIDDEN") {
      await emitCrmAccessDeniedAudit(supabaseAdmin, {
        workspaceId: callerWorkspaceId,
        requestId,
        resource: "/functions/v1/crm-hubspot-import",
        reasonCode: "run_workspace_mismatch",
        actorUserId: authData.user.id,
        ipInet: extractRequestIp(req.headers),
        userAgent: req.headers.get("user-agent"),
        metadata: {
          run_id: body.runId ?? null,
        },
      });
      return errorResponse(
        403,
        "FORBIDDEN",
        "Import run is outside your workspace.",
        {
          headers: ch,
          details: { requestId },
        },
      );
    }

    if (message === "RUN_ACTOR_FORBIDDEN") {
      await emitCrmAccessDeniedAudit(supabaseAdmin, {
        workspaceId: callerWorkspaceId,
        requestId,
        resource: "/functions/v1/crm-hubspot-import",
        reasonCode: "run_actor_forbidden",
        actorUserId: authData.user.id,
        ipInet: extractRequestIp(req.headers),
        userAgent: req.headers.get("user-agent"),
        metadata: {
          run_id: body.runId ?? null,
        },
      });
      return errorResponse(
        403,
        "FORBIDDEN",
        "Caller is not allowed to resume this import run.",
        {
          headers: ch,
          details: { requestId },
        },
      );
    }

    if (message.startsWith("RUN_CREATE_FAILED:")) {
      return errorResponse(
        500,
        "RUN_CREATE_FAILED",
        "Failed to create import run.",
        {
          headers: ch,
          details: { requestId, message },
        },
      );
    }

    return errorResponse(
      500,
      "RUN_STATE_ERROR",
      "Unable to prepare import run state.",
      {
        headers: ch,
        details: { requestId, message },
      },
    );
  }

  await updateRun(supabaseAdmin, state, "running");

  try {
    await runHubSpotImport(supabaseAdmin, state);

    const finalStatus = state.errorCount > 0
      ? "completed_with_errors"
      : "completed";
    await updateRun(supabaseAdmin, state, finalStatus);

    return jsonResponse(
      {
        runId: state.runId,
        status: finalStatus,
        counts: {
          companies: state.companiesProcessed,
          contacts: state.contactsProcessed,
          deals: state.dealsProcessed,
          activities: state.activitiesProcessed,
          errors: state.errorCount,
        },
      },
      { headers: ch },
    );
  } catch (error) {
    captureEdgeException(error, { fn: "crm-hubspot-import", req });
    const message = error instanceof Error ? error.message : String(error);
    try {
      await updateRun(supabaseAdmin, state, "failed", message);
    } catch (updateError) {
      console.error("[crm-import] unable to mark run as failed", updateError);
    }

    return errorResponse(500, "IMPORT_FAILED", "QRM HubSpot import failed.", {
      headers: ch,
      details: { requestId, message },
    });
  }
});
