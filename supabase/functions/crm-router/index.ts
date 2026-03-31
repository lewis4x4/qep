import { resolveCallerContext } from "../_shared/dge-auth.ts";
import {
  crmFail,
  crmOk,
  crmOptionsResponse,
  normalizeRouterPath,
  readJsonBody,
  safeText,
} from "../_shared/crm-router-http.ts";
import {
  createRequestContext,
  crmSearch,
  deny,
  getCompanyHierarchy,
  hydrateCaller,
  mergeContacts,
  refreshDuplicates,
  requireCaller,
  requireDefinitionWriter,
  requireElevated,
} from "../_shared/crm-router-service.ts";
import {
  createActivity,
  deliverActivity,
  patchActivity,
  createCustomFieldDefinition,
  createEquipment,
  dismissDuplicateCandidate,
  getRecordCustomFields,
  listCustomFieldDefinitions,
  listDuplicateCandidates,
  listEquipment,
  patchDeal,
  patchCompanyParent,
  patchCustomFieldDefinition,
  patchEquipment,
  upsertRecordCustomFields,
  type ActivityDeliverPayload,
  type ActivityPayload,
  type ActivityPatchPayload,
  type CustomFieldDefinitionPayload,
  type CustomRecordType,
  type DealPatchPayload,
  type EquipmentPayload,
} from "../_shared/crm-router-data.ts";

function asRecordType(value: string | null): CustomRecordType | null {
  if (value === "contact" || value === "company" || value === "equipment") {
    return value;
  }
  return null;
}

function mapError(origin: string | null, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "UNAUTHORIZED") {
    return crmFail({
      origin,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Missing or invalid authentication.",
    });
  }

  if (message === "FORBIDDEN") {
    return crmFail({
      origin,
      status: 403,
      code: "FORBIDDEN",
      message: "Caller role is not authorized for this operation.",
    });
  }

  if (message === "NOT_FOUND") {
    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "Requested CRM resource was not found.",
    });
  }

  if (message === "HUBSPOT_ID_CONFLICT") {
    return crmFail({
      origin,
      status: 409,
      code: "HUBSPOT_ID_CONFLICT",
      message: "Contacts cannot be merged because both have different HubSpot IDs.",
      details: { reason_code: "hubspot_id_conflict" },
    });
  }

  if (message === "HIERARCHY_CYCLE") {
    return crmFail({
      origin,
      status: 409,
      code: "HIERARCHY_CYCLE",
      message: "Parent company selection creates a hierarchy cycle.",
    });
  }

  if (message === "VALIDATION_ACTIVITY_BODY_REQUIRED") {
    return crmFail({
      origin,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Add activity details before saving.",
    });
  }

  if (message === "VALIDATION_ACTIVITY_BODY_LOCKED") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Sent messages are locked. Log a follow-up instead.",
    });
  }

  if (message === "VALIDATION_ACTIVITY_DELIVERY_IN_PROGRESS") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "This message is sending now. Try again when delivery finishes.",
    });
  }

  if (message === "VALIDATION_ACTIVITY_DELIVERY_REVIEW_REQUIRED") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "A previous delivery attempt needs review before another send.",
    });
  }

  if (message === "VALIDATION_ACTIVITY_STALE") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "This activity changed somewhere else. Refresh and try again.",
    });
  }

  if (
    message.startsWith("VALIDATION_") ||
    message.startsWith("UNKNOWN_CUSTOM_FIELD:") ||
    message.startsWith("INVALID_CUSTOM_FIELD_TYPE:") ||
    message.startsWith("MISSING_REQUIRED_CUSTOM_FIELDS:")
  ) {
    const details = message.startsWith("MISSING_REQUIRED_CUSTOM_FIELDS:")
      ? {
        missing_keys: message
          .replace("MISSING_REQUIRED_CUSTOM_FIELDS:", "")
          .split(",")
          .filter((key) => key.length > 0),
      }
      : undefined;

    return crmFail({
      origin,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      details,
    });
  }

  return crmFail({
    origin,
    status: 500,
    code: "UNEXPECTED_ERROR",
    message: "CRM router request failed.",
    details: { reason: message },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return crmOptionsResponse(origin);
  }

  const url = new URL(req.url);
  const path = normalizeRouterPath(url.pathname);
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0 || segments[0] !== "crm") {
    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "CRM route not found.",
    });
  }

  const ctxBase = createRequestContext(req, path, req.method);
  const ctx = await hydrateCaller(req, ctxBase, resolveCallerContext);

  try {
    if (req.method === "GET" && segments[1] === "search") {
      requireCaller(ctx);
      const q = url.searchParams.get("q") ?? "";
      const types = url.searchParams.get("types") ?? "contact,company";
      const results = await crmSearch(ctx, q, types);
      return crmOk({ results }, { origin });
    }

    if (
      req.method === "GET" &&
      segments[1] === "companies" &&
      segments[2] &&
      segments[3] === "hierarchy"
    ) {
      requireCaller(ctx);
      const hierarchy = await getCompanyHierarchy(ctx, segments[2]);
      if (!hierarchy) {
        return crmFail({
          origin,
          status: 404,
          code: "NOT_FOUND",
          message: "Company not found or inaccessible.",
        });
      }
      return crmOk(hierarchy, { origin });
    }

    if (segments[1] === "activities" && req.method === "POST" && segments.length === 2) {
      requireCaller(ctx);
      const body = await readJsonBody<ActivityPayload>(req);
      const activity = await createActivity(ctx, body);
      return crmOk({ activity }, { origin, status: 201 });
    }

    if (segments[1] === "activities" && req.method === "PATCH" && segments.length === 3) {
      requireCaller(ctx);
      const body = await readJsonBody<ActivityPatchPayload>(req);
      const activity = await patchActivity(ctx, segments[2], body);
      return crmOk({ activity }, { origin });
    }

    if (
      segments[1] === "activities" &&
      req.method === "POST" &&
      segments.length === 4 &&
      segments[3] === "deliver"
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<ActivityDeliverPayload>(req);
      const activity = await deliverActivity(ctx, segments[2], body);
      return crmOk({ activity }, { origin });
    }

    if (
      segments[1] === "deals" &&
      req.method === "PATCH" &&
      segments.length === 3
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<DealPatchPayload>(req);
      const deal = await patchDeal(ctx, segments[2], body);
      return crmOk({ deal }, { origin });
    }

    if (
      req.method === "PATCH" &&
      segments[1] === "companies" &&
      segments[2] &&
      segments[3] === "parent"
    ) {
      requireCaller(ctx);
      requireElevated(ctx);
      const body = await readJsonBody<{ parentCompanyId?: string | null }>(req);
      const company = await patchCompanyParent(
        ctx,
        segments[2],
        safeText(body.parentCompanyId ?? null),
      );
      return crmOk({ company }, { origin });
    }

    if (segments[1] === "equipment") {
      requireCaller(ctx);

      if (req.method === "GET" && segments.length === 2) {
        const companyId = safeText(url.searchParams.get("company_id"));
        const items = await listEquipment(ctx, companyId);
        return crmOk({ items }, { origin });
      }

      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody<EquipmentPayload>(req);
        const equipment = await createEquipment(ctx, body);
        return crmOk({ equipment }, { origin, status: 201 });
      }

      if (req.method === "PATCH" && segments.length === 3) {
        const body = await readJsonBody<Partial<EquipmentPayload>>(req);
        const equipment = await patchEquipment(ctx, segments[2], body);
        return crmOk({ equipment }, { origin });
      }
    }

    if (segments[1] === "custom-field-definitions") {
      requireCaller(ctx);

      if (req.method === "GET" && segments.length === 2) {
        const objectType = asRecordType(safeText(url.searchParams.get("object_type")));
        const items = await listCustomFieldDefinitions(ctx, objectType);
        return crmOk({ items }, { origin });
      }

      if (req.method === "POST" && segments.length === 2) {
        requireDefinitionWriter(ctx);
        const body = await readJsonBody<CustomFieldDefinitionPayload>(req);
        const definition = await createCustomFieldDefinition(ctx, body);
        return crmOk({ definition }, { origin, status: 201 });
      }

      if (req.method === "PATCH" && segments.length === 3) {
        requireDefinitionWriter(ctx);
        const body = await readJsonBody<Partial<CustomFieldDefinitionPayload>>(req);
        const definition = await patchCustomFieldDefinition(ctx, segments[2], body);
        return crmOk({ definition }, { origin });
      }
    }

    if (segments[1] === "custom-fields") {
      requireCaller(ctx);

      if (req.method === "GET") {
        const recordType = asRecordType(safeText(url.searchParams.get("record_type")));
        const recordId = safeText(url.searchParams.get("record_id"));
        if (!recordType || !recordId) {
          return crmFail({
            origin,
            status: 400,
            code: "VALIDATION_ERROR",
            message: "record_type and record_id are required.",
          });
        }

        const fields = await getRecordCustomFields(ctx, recordType, recordId);
        return crmOk({ fields }, { origin });
      }

      if (req.method === "PATCH") {
        const body = await readJsonBody<{
          recordType?: CustomRecordType;
          recordId?: string;
          values?: Record<string, unknown>;
        }>(req);
        const recordType = asRecordType(body.recordType ?? null);
        const recordId = safeText(body.recordId ?? null);
        const values = body.values ?? {};

        if (!recordType || !recordId || typeof values !== "object") {
          return crmFail({
            origin,
            status: 400,
            code: "VALIDATION_ERROR",
            message: "recordType, recordId, and values are required.",
          });
        }

        const fields = await upsertRecordCustomFields(ctx, recordType, recordId, values);
        return crmOk({ fields }, { origin });
      }
    }

    if (segments[1] === "duplicates") {
      requireCaller(ctx);

      if (req.method === "GET" && segments.length === 2) {
        const status = safeText(url.searchParams.get("status")) ?? "open";
        if (
          (ctx.caller.isServiceRole || ctx.caller.role === "admin" ||
            ctx.caller.role === "manager" || ctx.caller.role === "owner") &&
          url.searchParams.get("refresh") !== "false"
        ) {
          await refreshDuplicates(ctx);
        }

        const candidates = await listDuplicateCandidates(
          ctx,
          status === "dismissed" || status === "merged" ? status : "open",
        );
        return crmOk({ candidates }, { origin });
      }

      if (req.method === "POST" && segments.length === 4 && segments[3] === "dismiss") {
        requireElevated(ctx);
        await dismissDuplicateCandidate(ctx, segments[2]);
        return crmOk({ ok: true }, { origin });
      }
    }

    if (req.method === "POST" && segments[1] === "merges") {
      requireCaller(ctx);
      requireElevated(ctx);
      const body = await readJsonBody<{ survivorId?: string; loserId?: string }>(req);
      const survivorId = safeText(body.survivorId ?? null);
      const loserId = safeText(body.loserId ?? null);

      if (!survivorId || !loserId) {
        return crmFail({
          origin,
          status: 400,
          code: "VALIDATION_ERROR",
          message: "survivorId and loserId are required.",
        });
      }

      const mergeResult = await mergeContacts(
        ctx,
        survivorId,
        loserId,
        safeText(req.headers.get("idempotency-key")),
      );
      return crmOk({ merge: mergeResult }, { origin });
    }

    return crmFail({
      origin,
      status: 404,
      code: "NOT_FOUND",
      message: "CRM route not found.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") {
      await deny(ctx, "caller_identity_unresolved");
    } else if (message === "FORBIDDEN") {
      await deny(ctx, "insufficient_role_for_route");
    }

    return mapError(origin, error);
  }
});
