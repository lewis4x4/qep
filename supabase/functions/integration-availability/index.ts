import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { findWorkspaceRefreshJob } from "../_shared/dge-refresh-jobs.ts";
import { fail, ok, optionsResponse, readJsonObject } from "../_shared/dge-http.ts";
import type { IntegrationStatusEnum } from "../_shared/integration-types.ts";

interface AvailabilityRequestBody {
  integration_key?: string;
}

interface IntegrationStatusRow {
  workspace_id: string;
  status: IntegrationStatusEnum;
}

function isSupportedIntegrationKey(key: string): boolean {
  return key === "intellidealer" || key === "sendgrid" || key === "twilio";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for integration availability checks.",
    });
  }

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

    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.userId || !caller.role) {
      return fail({
        origin,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Missing or invalid authentication.",
      });
    }

    const workspaceId = caller.workspaceId ?? "default";
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

    const refreshJob = await findWorkspaceRefreshJob(adminClient, {
      workspaceId,
      jobType: "economic_sync_refresh",
    });
    const status = scopedRow?.status ?? "pending_credentials";

    return ok(
      {
        integration_key: integrationKey,
        workspace_id: workspaceId,
        status,
        connected: status === "connected",
        refresh_pending: Boolean(refreshJob),
        safe_mode: Boolean(refreshJob) || status !== "connected",
        refresh_job_id: refreshJob?.id ?? null,
      },
      { origin },
    );
  } catch (error) {
    return fail({
      origin,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Integration availability check failed.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
