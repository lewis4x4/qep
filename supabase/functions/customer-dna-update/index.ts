import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  cleanString,
  type CustomerDnaLookupInput,
} from "../_shared/customer-dna-store.ts";
import { refreshCustomerProfileSnapshot } from "../_shared/customer-profile-refresh.ts";
import {
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";

Deno.serve(async (req): Promise<Response> => {
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

  const adminClient = createAdminClient();

  try {
    const caller = await resolveCallerContext(req, adminClient);
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

    const rateLimit = checkRateLimit({
      key: caller.isServiceRole
        ? "customer-dna-update:service"
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

    const refreshed = await refreshCustomerProfileSnapshot(adminClient, {
      lookup: body,
      actorRole: caller.role,
      actorUserId: caller.userId,
      isServiceRole: caller.isServiceRole,
    });

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

    return fail({
      origin,
      status: 500,
      code: "UNEXPECTED_ERROR",
      message: "Unexpected customer DNA update failure.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
