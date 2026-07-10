import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  cleanString,
  type CustomerDnaLookupInput,
  CustomerDnaTargetNotFoundError,
  CustomerDnaWorkspaceError,
} from "../_shared/customer-dna-store.ts";
import { refreshCustomerProfileSnapshot } from "../_shared/customer-profile-refresh.ts";
import {
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";

export interface CustomerDnaUpdateDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  refreshCustomerProfileSnapshot: typeof refreshCustomerProfileSnapshot;
  checkRateLimit: typeof checkRateLimit;
}

const defaultDependencies: CustomerDnaUpdateDependencies = {
  createAdminClient,
  resolveCallerContext,
  refreshCustomerProfileSnapshot,
  checkRateLimit,
};

export function resolveCustomerDnaTargetWorkspace(params: {
  isServiceRole: boolean;
  callerWorkspaceId: string | null;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; workspaceId: string }
  | { ok: false; status: 400 | 403; code: string; message: string } {
  const callerWorkspaceId = cleanString(params.callerWorkspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);

  if (
    callerWorkspaceId && requestedWorkspaceId &&
    callerWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      code: "WORKSPACE_MISMATCH",
      message: "The requested workspace is not authorized for this caller.",
    };
  }

  if (params.isServiceRole) {
    const workspaceId = callerWorkspaceId ?? requestedWorkspaceId;
    return workspaceId ? { ok: true, workspaceId } : {
      ok: false,
      status: 400,
      code: "WORKSPACE_REQUIRED",
      message: "Service callers must provide an explicit workspace target.",
    };
  }

  if (!callerWorkspaceId) {
    return {
      ok: false,
      status: 403,
      code: "WORKSPACE_REQUIRED",
      message: "The authenticated user has no authorized workspace.",
    };
  }

  return { ok: true, workspaceId: callerWorkspaceId };
}

export async function handleCustomerDnaUpdate(
  req: Request,
  overrides: Partial<CustomerDnaUpdateDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  if (req.method !== "POST") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for customer DNA updates.",
    });
  }

  try {
    const adminClient = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, adminClient);
    if (!caller.isServiceRole && (!caller.userId || !caller.role)) {
      return fail({
        origin,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Missing or invalid authentication.",
      });
    }

    if (
      !caller.isServiceRole &&
      caller.role !== "admin" &&
      caller.role !== "manager" &&
      caller.role !== "owner"
    ) {
      return fail({
        origin,
        status: 403,
        code: "FORBIDDEN",
        message: "Only admin/manager/owner roles can refresh customer DNA.",
      });
    }

    const body = await readJsonObject<CustomerDnaLookupInput>(req);
    const hasIdentifier = Boolean(
      cleanString(body?.customer_profiles_extended_id) ||
        cleanString(body?.hubspot_contact_id) ||
        cleanString(body?.intellidealer_customer_id) ||
        cleanString(body?.email),
    );
    if (!hasIdentifier) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_REQUEST",
        message:
          "Provide customer_profiles_extended_id, hubspot_contact_id, intellidealer_customer_id, or email.",
      });
    }

    const targetWorkspace = resolveCustomerDnaTargetWorkspace({
      isServiceRole: caller.isServiceRole,
      callerWorkspaceId: caller.workspaceId,
      requestedWorkspaceId: cleanString(body?.workspace_id),
    });
    if (!targetWorkspace.ok) {
      return fail({
        origin,
        status: targetWorkspace.status,
        code: targetWorkspace.code,
        message: targetWorkspace.message,
      });
    }

    const rateLimit = dependencies.checkRateLimit({
      key: caller.isServiceRole
        ? `customer-dna-update:service:${targetWorkspace.workspaceId}`
        : `customer-dna-update:${caller.userId}`,
      limit: caller.isServiceRole ? 300 : 60,
    });
    if (!rateLimit.allowed) {
      return fail({
        origin,
        status: 429,
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: { retry_after_seconds: rateLimit.retryAfterSeconds },
      });
    }

    const refreshed = await dependencies.refreshCustomerProfileSnapshot(
      adminClient,
      {
        lookup: body,
        actorRole: caller.role,
        actorUserId: caller.userId,
        isServiceRole: caller.isServiceRole,
        workspaceId: targetWorkspace.workspaceId,
      },
    );

    return ok(refreshed, { origin });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      });
    }

    if (error instanceof CustomerDnaWorkspaceError) {
      return fail({
        origin,
        status: 403,
        code: "WORKSPACE_MISMATCH",
        message: error.message,
      });
    }

    if (error instanceof CustomerDnaTargetNotFoundError) {
      return fail({
        origin,
        status: 404,
        code: "CUSTOMER_NOT_FOUND",
        message: error.message,
      });
    }

    return fail({
      origin,
      status: 500,
      code: "UNEXPECTED_ERROR",
      message: "Unexpected customer DNA update failure.",
    });
  }
}
