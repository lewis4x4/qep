import {
  createAdminClient,
  createCallerClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  type CustomerProfileRow,
  type FleetRow,
  mapCustomerProfileDto,
} from "../_shared/customer-profile-dto.ts";
import {
  buildDgeRefreshDedupeKey,
  enqueueDgeRefreshJob,
  findOpenDgeRefreshJob,
  triggerDgeRefreshWorker,
} from "../_shared/dge-refresh-jobs.ts";
import { fail, ok, optionsResponse } from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";
import {
  mergeSnapshotBadges,
  resolveRefreshEnvelope,
} from "../_shared/dge-refresh-state.ts";

function clean(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBooleanQuery(value: string | null): boolean {
  return value === "true" || value === "1";
}

const CUSTOMER_PROFILE_STALE_MS = Number.parseInt(
  Deno.env.get("CUSTOMER_PROFILE_STALE_MS") ?? String(4 * 60 * 60 * 1000),
  10,
);

Deno.serve(async (req): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "GET") {
    return fail({
      origin,
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Use GET for customer profile reads.",
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
      caller.role !== "rep" &&
      caller.role !== "admin" &&
      caller.role !== "manager" &&
      caller.role !== "owner"
    ) {
      return fail({
        origin,
        status: 403,
        code: "FORBIDDEN",
        message: "Role is not permitted to read customer profiles.",
      });
    }

    const rateLimit = checkRateLimit({
      key: caller.isServiceRole
        ? "customer-profile:service"
        : `customer-profile:${caller.userId}`,
      limit: caller.isServiceRole ? 300 : 30,
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

    const url = new URL(req.url);
    const profileId = clean(
      url.searchParams.get("customer_profiles_extended_id"),
    );
    const hubspotContactId = clean(url.searchParams.get("hubspot_contact_id"));
    const intellidealerCustomerId = clean(
      url.searchParams.get("intellidealer_customer_id"),
    );
    const email = clean(url.searchParams.get("email"));
    const includeFleet = parseBooleanQuery(
      url.searchParams.get("include_fleet"),
    );
    const refreshRequested = parseBooleanQuery(url.searchParams.get("refresh"));

    if (!profileId && !hubspotContactId && !intellidealerCustomerId && !email) {
      return fail({
        origin,
        status: 400,
        code: "INVALID_REQUEST",
        message:
          "Provide customer_profiles_extended_id, hubspot_contact_id, intellidealer_customer_id, or email.",
      });
    }

    let resolvedHubspotContactId = hubspotContactId;
    if (!resolvedHubspotContactId && email) {
      const { data: contactByEmail } = await adminClient
        .from("crm_contacts")
        .select("hubspot_contact_id")
        .ilike("email", email)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

      resolvedHubspotContactId = clean(
        contactByEmail?.hubspot_contact_id ?? null,
      );
    }

    let query = adminClient.from("customer_profiles_extended").select("*")
      .limit(1);
    if (profileId) {
      query = query.eq("id", profileId);
    } else if (resolvedHubspotContactId) {
      query = query.eq("hubspot_contact_id", resolvedHubspotContactId);
    } else if (intellidealerCustomerId) {
      query = query.eq("intellidealer_customer_id", intellidealerCustomerId);
    }

    const { data: profileData, error: profileError } = await query
      .maybeSingle();
    if (profileError) {
      return fail({
        origin,
        status: 500,
        code: "DB_READ_FAILED",
        message: "Failed to fetch customer profile.",
        details: { reason: profileError.message },
      });
    }

    if (!profileData) {
      return fail({
        origin,
        status: 404,
        code: "NOT_FOUND",
        message: "Customer profile not found.",
      });
    }

    const profile = profileData as CustomerProfileRow;

    if (!caller.isServiceRole && caller.role === "rep") {
      const hubspotId = profile.hubspot_contact_id;
      if (!hubspotId || !caller.authHeader) {
        return fail({
          origin,
          status: 403,
          code: "FORBIDDEN",
          message: "Rep access requires a mapped HubSpot contact.",
        });
      }

      const callerClient = createCallerClient(caller.authHeader);
      const { data: accessRow } = await callerClient
        .from("crm_contacts")
        .select("id")
        .eq("hubspot_contact_id", hubspotId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

      if (!accessRow) {
        return fail({
          origin,
          status: 403,
          code: "FORBIDDEN",
          message: "Rep cannot access this customer profile.",
        });
      }
    }

    let fleet: FleetRow[] = [];
    const managerFieldsVisible = caller.isServiceRole ||
      caller.role === "admin" || caller.role === "manager" ||
      caller.role === "owner";
    if (includeFleet && managerFieldsVisible) {
      const { data: fleetRows } = await adminClient
        .from("fleet_intelligence")
        .select(
          "id, equipment_serial, make, model, year, current_hours, predicted_replacement_date, replacement_confidence",
        )
        .eq("customer_profile_id", profile.id)
        .order("predicted_replacement_date", { ascending: true })
        .limit(50);

      fleet = (fleetRows ?? []) as FleetRow[];
    }

    const workspaceId = caller.workspaceId ?? "default";
    const dedupeKey = buildDgeRefreshDedupeKey(
      "customer_profile_refresh",
      profile.id,
    );
    let openJob = await findOpenDgeRefreshJob(adminClient, {
      workspaceId,
      dedupeKey,
    });
    let queueError: string | null = null;

    if (refreshRequested) {
      try {
        const enqueued = await enqueueDgeRefreshJob(adminClient, {
          workspaceId,
          jobType: "customer_profile_refresh",
          dedupeKey,
          requestPayload: {
            customer_profiles_extended_id: profile.id,
            hubspot_contact_id: profile.hubspot_contact_id,
            intellidealer_customer_id: profile.intellidealer_customer_id,
            requested_by: caller.userId,
          },
          requestedBy: caller.userId,
          priority: 40,
        });

        openJob = {
          id: enqueued.jobId,
          workspace_id: workspaceId,
          job_type: "customer_profile_refresh",
          dedupe_key: dedupeKey,
          status: enqueued.status,
          created_at: new Date().toISOString(),
          last_error: null,
        };
        if (enqueued.enqueued) {
          await triggerDgeRefreshWorker();
        }
      } catch (error) {
        queueError = error instanceof Error ? error.message : String(error);
      }
    }

    const metadata = profile.metadata ?? {};
    const snapshotUpdatedAt = typeof metadata.last_dna_refresh_at === "string"
      ? metadata.last_dna_refresh_at
      : profile.updated_at;
    const refresh = resolveRefreshEnvelope({
      snapshotUpdatedAt,
      staleAfterMs: CUSTOMER_PROFILE_STALE_MS,
      openJob: openJob
        ? {
          id: openJob.id,
          status: openJob.status,
          created_at: openJob.created_at,
          last_error: openJob.last_error,
        }
        : null,
    });

    if (queueError) {
      refresh.status = "degraded";
      refresh.last_error = queueError;
    }

    const response = mapCustomerProfileDto({
      row: profile,
      role: caller.role,
      isServiceRole: caller.isServiceRole,
      includeFleet,
      fleet,
      dataBadges: mergeSnapshotBadges([], refresh),
      refresh,
    });

    await adminClient
      .from("customer_profile_access_audit")
      .insert({
        customer_profile_id: profile.id,
        actor_user_id: caller.userId,
        actor_role: caller.isServiceRole ? "service" : caller.role,
        hubspot_contact_id: profile.hubspot_contact_id,
        intellidealer_customer_id: profile.intellidealer_customer_id,
        access_mode: caller.isServiceRole ? "service" : "user",
        source: "customer-profile",
      });

    return ok(response, { origin });
  } catch (error) {
    return fail({
      origin,
      status: 500,
      code: "UNEXPECTED_ERROR",
      message: "Unexpected customer profile read failure.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
