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
  createCampaign,
  executeCampaign,
  listCampaignRecipients,
  listCampaigns,
  patchCampaign,
  type CampaignPayload,
} from "../_shared/crm-campaigns.ts";
import {
  createMove,
  listMoves,
  parseMoveListFilters,
  patchMove,
  type MoveCreatePayload,
  type MovePatchPayload,
} from "../_shared/qrm-moves.ts";
import {
  ingestSignal,
  listSignals,
  listSignalsByIds,
  parseSignalListFilters,
  type SignalIngestPayload,
} from "../_shared/qrm-signals.ts";
import {
  archiveOnOrderEquipment,
  createActivity,
  createCompany,
  createCompanyShipTo,
  createContact,
  deliverActivity,
  patchActivity,
  patchCompany,
  createCustomFieldDefinition,
  createDeal,
  createEquipment,
  getEquipment,
  findEquipmentInvoiceReversalCandidate,
  dismissDuplicateCandidate,
  getCommunicationTarget,
  getRecordCustomFields,
  listCustomFieldDefinitions,
  listCompanyShipTos,
  listDuplicateCandidates,
  listEquipment,
  listEquipmentForCompanySubtree,
  quickAddOnOrderEquipment,
  listDealEquipment,
  linkDealEquipment,
  unlinkDealEquipment,
  patchContact,
  patchDeal,
  patchCompanyParent,
  patchCompanyShipTo,
  patchCustomFieldDefinition,
  patchEquipment,
  upsertRecordCustomFields,
  type ActivityDeliverPayload,
  type ActivityPayload,
  type ActivityPatchPayload,
  type CompanyShipToPayload,
  type CompanyUpsertPayload,
  type CommunicationTargetPayload,
  type ContactUpsertPayload,
  type CustomFieldDefinitionPayload,
  type CustomRecordType,
  type DealCreatePayload,
  type DealEquipmentPayload,
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
  if (error instanceof SyntaxError) {
    return crmFail({
      origin,
      status: 400,
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    });
  }

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

  if (message === "FORBIDDEN_CUSTOMER_EIN_WRITE") {
    return crmFail({
      origin,
      status: 403,
      code: "FORBIDDEN",
      message: "Caller role is not authorized to write customer EIN.",
    });
  }

  if (message === "SERVICE_WORKSPACE_UNBOUND") {
    return crmFail({
      origin,
      status: 403,
      code: "FORBIDDEN",
      message: "Service callers must present a signed workspace claim.",
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

  if (message === "CONTACT_ARCHIVE_HAS_DEALS") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Move or close this contact's active deals before archiving the contact.",
    });
  }

  if (message === "CONTACT_ARCHIVE_HAS_EQUIPMENT") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Reassign linked equipment before archiving the contact.",
    });
  }

  if (message === "COMPANY_ARCHIVE_HAS_CHILDREN") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Remove or re-parent child companies before archiving this company.",
    });
  }

  if (message === "COMPANY_ARCHIVE_HAS_CONTACTS") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Move linked contacts before archiving this company.",
    });
  }

  if (message === "COMPANY_ARCHIVE_HAS_DEALS") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Move or close active deals before archiving this company.",
    });
  }

  if (message === "COMPANY_ARCHIVE_HAS_EQUIPMENT") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Reassign linked equipment before archiving this company.",
    });
  }

  if (message === "VALIDATION_DUPLICATE_VIN_PIN") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Another equipment record in this workspace already uses that VIN/PIN.",
    });
  }

  if (message === "VALIDATION_DUPLICATE_ASSET_TAG") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Another equipment record in this workspace already uses that asset tag.",
    });
  }

  if (message === "VALIDATION_EQUIPMENT_ALREADY_LINKED") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "This equipment is already linked to this deal.",
    });
  }

  if (message === "VALIDATION_ON_ORDER_ARCHIVE_ONLY") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Only on-order quick-add equipment can be archived from this action.",
    });
  }

  if (message === "DEAL_ARCHIVE_HAS_QUOTES") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Archive or unlink active quotes before archiving this deal.",
    });
  }

  if (message === "DEAL_ARCHIVE_HAS_SEQUENCES") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Pause or cancel live follow-up enrollments before archiving this deal.",
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

  if (message === "VALIDATION_ACTIVITY_OCCURRED_AT_LOCKED") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Delivered messages are locked. Log a follow-up instead.",
    });
  }

  if (message === "VALIDATION_ACTIVITY_ARCHIVE_LOCKED") {
    return crmFail({
      origin,
      status: 409,
      code: "VALIDATION_ERROR",
      message: "Delivered messages stay on the record. Archive only manual or failed entries.",
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

  if (message === "VALIDATION_INVALID_OCCURRED_AT") {
    return crmFail({
      origin,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Enter a valid activity time.",
    });
  }

  if (message === "VALIDATION_STAGE_CREATE_OPEN_ONLY") {
    return crmFail({
      origin,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Start new deals in an open stage, then close them from the deal record.",
    });
  }

  if (
    message === "VALIDATION_CAMPAIGN_REQUIRED_FIELDS" ||
    message === "VALIDATION_CAMPAIGN_PATCH_REQUIRED" ||
    message === "VALIDATION_CAMPAIGN_EXECUTION_READY"
  ) {
    return crmFail({
      origin,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Campaign request validation failed.",
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

  console.error("[crm-router] unexpected error:", message);
  return crmFail({
    origin,
    status: 500,
    code: "UNEXPECTED_ERROR",
    message: "CRM router request failed.",
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

  // Accept both "crm" (legacy) and "qrm" (canonical post-rename) as the first segment.
  // The frontend calls /functions/v1/qrm-router/qrm/... after the Tier 4 rename;
  // external callers that still target /functions/v1/crm-router/crm/... also work.
  if (
    segments.length === 0 ||
    (segments[0] !== "crm" && segments[0] !== "qrm")
  ) {
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
      // Default to universal search across all known entity types; callers
      // that want a narrower slice (e.g. the header search bar) pass `types`.
      const types = url.searchParams.get("types") ?? "contact,company,deal,equipment,rental";
      const results = await crmSearch(ctx, q, types);
      return crmOk({ results }, { origin });
    }

    if (
      req.method === "GET" &&
      segments[1] === "communication-target" &&
      segments.length === 2
    ) {
      requireCaller(ctx);
      const body = {
        activityType: safeText(url.searchParams.get("activity_type")) as CommunicationTargetPayload["activityType"],
        companyId: safeText(url.searchParams.get("company_id")),
        contactId: safeText(url.searchParams.get("contact_id")),
        dealId: safeText(url.searchParams.get("deal_id")),
      };
      if (body.activityType !== "email" && body.activityType !== "sms") {
        return crmFail({
          origin,
          status: 400,
          code: "VALIDATION_ERROR",
          message: "activity_type must be email or sms.",
        });
      }
      const target = await getCommunicationTarget(ctx, body);
      return crmOk({ target }, { origin });
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

    if (
      req.method === "GET" &&
      segments[1] === "companies" &&
      segments[2] &&
      segments[3] === "ship-tos" &&
      segments.length === 4
    ) {
      requireCaller(ctx);
      const shipTos = await listCompanyShipTos(ctx, segments[2]);
      return crmOk({ shipTos }, { origin });
    }

    if (
      req.method === "POST" &&
      segments[1] === "companies" &&
      segments[2] &&
      segments[3] === "ship-tos" &&
      segments.length === 4
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<CompanyShipToPayload>(req);
      const shipTo = await createCompanyShipTo(ctx, segments[2], body);
      return crmOk({ shipTo }, { origin, status: 201 });
    }

    if (
      req.method === "PATCH" &&
      segments[1] === "companies" &&
      segments[2] &&
      segments[3] === "ship-tos" &&
      segments[4] &&
      segments.length === 5
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<CompanyShipToPayload>(req);
      const shipTo = await patchCompanyShipTo(ctx, segments[2], segments[4], body);
      return crmOk({ shipTo }, { origin });
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

    if (segments[1] === "campaigns") {
      requireCaller(ctx);
      requireElevated(ctx);

      if (req.method === "GET" && segments.length === 2) {
        const campaigns = await listCampaigns(ctx);
        return crmOk({ campaigns }, { origin });
      }

      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody<CampaignPayload>(req);
        const campaign = await createCampaign(ctx, body);
        return crmOk({ campaign }, { origin, status: 201 });
      }

      if (req.method === "PATCH" && segments.length === 3) {
        const body = await readJsonBody<CampaignPayload>(req);
        const campaign = await patchCampaign(ctx, segments[2], body);
        return crmOk({ campaign }, { origin });
      }

      if (req.method === "GET" && segments.length === 4 && segments[3] === "recipients") {
        const recipients = await listCampaignRecipients(ctx, segments[2]);
        return crmOk({ recipients }, { origin });
      }

      if (req.method === "POST" && segments.length === 4 && segments[3] === "execute") {
        const result = await executeCampaign(ctx, segments[2]);
        return crmOk({ result }, { origin });
      }
    }

    if (
      segments[1] === "contacts" &&
      req.method === "POST" &&
      segments.length === 2
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<ContactUpsertPayload>(req);
      const contact = await createContact(ctx, body);
      return crmOk({ contact }, { origin, status: 201 });
    }

    if (
      segments[1] === "contacts" &&
      req.method === "PATCH" &&
      segments.length === 3
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<ContactUpsertPayload>(req);
      const contact = await patchContact(ctx, segments[2], body);
      return crmOk({ contact }, { origin });
    }

    if (
      segments[1] === "companies" &&
      req.method === "POST" &&
      segments.length === 2
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<CompanyUpsertPayload>(req);
      const company = await createCompany(ctx, body);
      return crmOk({ company }, { origin, status: 201 });
    }

    if (
      segments[1] === "companies" &&
      req.method === "PATCH" &&
      segments.length === 3
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<CompanyUpsertPayload>(req);
      const company = await patchCompany(ctx, segments[2], body);
      return crmOk({ company }, { origin });
    }

    if (
      segments[1] === "deals" &&
      req.method === "POST" &&
      segments.length === 2
    ) {
      requireCaller(ctx);
      const body = await readJsonBody<DealCreatePayload>(req);
      const deal = await createDeal(ctx, body);
      return crmOk({ deal }, { origin, status: 201 });
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
        const subtreeRoot = safeText(url.searchParams.get("subtree_root"));
        if (subtreeRoot) {
          try {
            const items = await listEquipmentForCompanySubtree(ctx, subtreeRoot);
            return crmOk({ items }, { origin });
          } catch (error) {
            if (error instanceof Error && error.message === "NOT_FOUND") {
              return crmFail({
                origin,
                status: 404,
                code: "NOT_FOUND",
                message: "Company not found or inaccessible.",
              });
            }
            throw error;
          }
        }
        const companyId = safeText(url.searchParams.get("company_id"));
        const items = await listEquipment(ctx, companyId);
        return crmOk({ items }, { origin });
      }

      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody<EquipmentPayload>(req);
        const equipment = await createEquipment(ctx, body);
        return crmOk({ equipment }, { origin, status: 201 });
      }

      if (req.method === "POST" && segments.length === 3 && segments[2] === "quick-add-on-order") {
        const body = await readJsonBody<Partial<EquipmentPayload>>(req);
        const equipment = await quickAddOnOrderEquipment(ctx, body);
        return crmOk({ equipment }, { origin, status: 201 });
      }

      if (req.method === "GET" && segments.length === 3 && segments[2] === "reversal-candidate") {
        requireElevated(ctx);
        const candidate = await findEquipmentInvoiceReversalCandidate(ctx, safeText(url.searchParams.get("stock_number")));
        return crmOk({ candidate }, { origin });
      }

      if (req.method === "GET" && segments.length === 3) {
        try {
          const equipment = await getEquipment(ctx, segments[2]);
          return crmOk({ equipment }, { origin });
        } catch (error) {
          if (error instanceof Error && error.message === "NOT_FOUND") {
            return crmFail({ origin, status: 404, code: "NOT_FOUND", message: "Equipment not found." });
          }
          throw error;
        }
      }

      if (req.method === "PATCH" && segments.length === 3) {
        const body = await readJsonBody<Partial<EquipmentPayload>>(req);
        const equipment = await patchEquipment(ctx, segments[2], body);
        return crmOk({ equipment }, { origin });
      }

      if (req.method === "DELETE" && segments.length === 3) {
        await archiveOnOrderEquipment(ctx, segments[2]);
        return crmOk({ archived: true }, { origin });
      }
    }

    if (segments[1] === "deal-equipment") {
      requireCaller(ctx);

      if (req.method === "GET" && segments.length === 2) {
        const dealId = safeText(url.searchParams.get("deal_id"));
        if (!dealId) {
          return crmFail({ origin, status: 400, code: "VALIDATION_ERROR", message: "deal_id is required." });
        }
        const items = await listDealEquipment(ctx, dealId);
        return crmOk({ items }, { origin });
      }

      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody<DealEquipmentPayload>(req);
        const link = await linkDealEquipment(ctx, body);
        return crmOk({ link }, { origin, status: 201 });
      }

      if (req.method === "DELETE" && segments.length === 3) {
        await unlinkDealEquipment(ctx, segments[2]);
        return crmOk({ deleted: true }, { origin });
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

    if (segments[1] === "moves") {
      requireCaller(ctx);

      // GET /qrm/moves — list moves (rep sees own, elevated sees all).
      if (req.method === "GET" && segments.length === 2) {
        const filters = parseMoveListFilters(url.searchParams);
        const moves = await listMoves(ctx, filters);
        return crmOk({ moves }, { origin });
      }

      // PATCH /qrm/moves/:id — lifecycle transition (accept/snooze/dismiss/
      // complete/reopen). RLS lets reps patch only their own assigned moves.
      // On `complete`, the service also auto-logs a touch (optionally with
      // the rep's channel/summary payload) and suppresses the triggering
      // signals for 7 days — Slice 5 closure loop.
      if (req.method === "PATCH" && segments.length === 3) {
        const body = await readJsonBody<MovePatchPayload>(req);
        const result = await patchMove(ctx, segments[2], body);
        return crmOk(
          {
            move: result.move,
            touch_id: result.touchId,
            signals_suppressed: result.signalsSuppressed,
          },
          { origin },
        );
      }

      // POST /qrm/moves — create (recommender / service-role + elevated only).
      // Reps cannot author moves directly; the recommender is the canonical
      // source, with elevated users able to hand-craft a move when needed.
      if (req.method === "POST" && segments.length === 2) {
        requireElevated(ctx);
        const body = await readJsonBody<MoveCreatePayload>(req);
        const move = await createMove(ctx, body);
        return crmOk({ move }, { origin, status: 201 });
      }
    }

    if (segments[1] === "signals") {
      requireCaller(ctx);

      // GET /qrm/signals — the Pulse feed. Any authenticated caller; RLS
      // filters to rows the caller can see. When the caller passes
      // `?ids=uuid1,uuid2,...`, the endpoint returns exactly those signals
      // (bounded to 20). This is what powers the "Triggered by" panel on
      // a MoveCard — Slice 5 closure loop.
      if (req.method === "GET" && segments.length === 2) {
        const idsParam = url.searchParams.get("ids");
        if (idsParam) {
          const ids = idsParam
            .split(",")
            .map((raw) => raw.trim())
            .filter((raw) => raw.length > 0);
          const signals = await listSignalsByIds(ctx, ids);
          return crmOk({ signals }, { origin });
        }
        const filters = parseSignalListFilters(url.searchParams);
        const signals = await listSignals(ctx, filters);
        return crmOk({ signals }, { origin });
      }

      // POST /qrm/signals — ingest a signal. Adapters (inbound-email,
      // telematics, news-scan) are the canonical writers; elevated users
      // can hand-author a signal for testing or manual triage. Reps cannot
      // write directly — requireElevated also permits service-role.
      if (req.method === "POST" && segments.length === 2) {
        requireElevated(ctx);
        const body = await readJsonBody<SignalIngestPayload>(req);
        const signal = await ingestSignal(ctx, body);
        return crmOk({ signal }, { origin, status: 201 });
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
    } else if (message === "SERVICE_WORKSPACE_UNBOUND") {
      await deny(ctx, "service_workspace_unbound");
    } else if (message === "FORBIDDEN") {
      await deny(ctx, "insufficient_role_for_route");
    }

    return mapError(origin, error);
  }
});
