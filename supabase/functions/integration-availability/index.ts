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
  config: Record<string, unknown> | null;
}

function isSupportedIntegrationKey(key: string): boolean {
  return /^[a-z0-9_]+$/.test(key) && key.length <= 80;
}

function isReplacedIntegration(key: string): boolean {
  return key === "intellidealer" || key === "hubspot";
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
        message: "integration_key is required and must contain only lowercase letters, numbers, or underscores.",
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
      .select("workspace_id, status, config")
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
    const replacementLifecycle =
      typeof scopedRow?.config?.lifecycle === "string" ? scopedRow.config.lifecycle : null;
    const deferredProvider =
      scopedRow?.config?.provider_scope === "wave_5_deferred_external" ||
      scopedRow?.config?.provider_scope === "parity_external_decision" ||
      scopedRow?.config?.implementation_status === "deferred" ||
      scopedRow?.config?.implementation_status === "decision_required" ||
      scopedRow?.config?.decision_required === true;
    const replaced = isReplacedIntegration(integrationKey) || replacementLifecycle === "replaced";
    const status = replaced ? "replaced" : (scopedRow?.status ?? "pending_credentials");

    return ok(
      {
        integration_key: integrationKey,
        workspace_id: workspaceId,
        status,
        connected: replaced ? true : status === "connected",
        refresh_pending: replaced ? false : Boolean(refreshJob),
        safe_mode: replaced ? false : Boolean(refreshJob) || status !== "connected",
        connectable: !replaced && !deferredProvider,
        deferred_provider: deferredProvider,
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
