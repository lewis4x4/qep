import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import {
  classifyPersona,
  computeCustomerDnaMetrics,
  type CrmDealSignal,
  type DealHistorySignal,
} from "../_shared/customer-dna-logic.ts";
import {
  cleanString,
  collectCustomerDnaBadges,
  type CustomerDnaLookupInput,
  fetchExistingCustomerProfile,
  resolveContactByLookup,
} from "../_shared/customer-dna-store.ts";
import {
  type CustomerProfileRow,
  mapCustomerProfileDto,
} from "../_shared/customer-profile-dto.ts";
import {
  fail,
  ok,
  optionsResponse,
  readJsonObject,
} from "../_shared/dge-http.ts";
import { checkRateLimit } from "../_shared/dge-rate-limit.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
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

    const contact = await resolveContactByLookup(adminClient, body);
    const existing = await fetchExistingCustomerProfile(
      adminClient,
      body,
      contact,
    );

    let profileId = existing?.id ?? null;
    if (!profileId) {
      const customerName = `${contact?.first_name ?? "Unknown"} ${
        contact?.last_name ?? "Customer"
      }`
        .trim();
      const { data: inserted, error: insertError } = await adminClient
        .from("customer_profiles_extended")
        .insert({
          hubspot_contact_id: cleanString(body.hubspot_contact_id) ??
            contact?.hubspot_contact_id ?? null,
          intellidealer_customer_id: cleanString(
            body.intellidealer_customer_id,
          ),
          customer_name: customerName,
          company_name: null,
          metadata: {
            data_badges: ["DEMO"],
            persona_reasoning: "Profile created from partial identifiers.",
          },
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        return fail({
          origin,
          status: 500,
          code: "DB_WRITE_FAILED",
          message: "Failed to create customer profile.",
          details: { reason: insertError?.message },
        });
      }

      profileId = inserted.id as string;
      if (contact?.id) {
        await adminClient
          .from("crm_contacts")
          .update({ dge_customer_profile_id: profileId })
          .eq("id", contact.id);
      }
    }

    const { data: profileData } = await adminClient
      .from("customer_profiles_extended")
      .select("*")
      .eq("id", profileId)
      .single();
    const profileRow = profileData as CustomerProfileRow;

    const { data: historyData } = await adminClient
      .from("customer_deal_history")
      .select(
        "outcome, sold_price, discount_pct, financing_used, attachments_sold, service_contract_sold, days_to_close, deal_date",
      )
      .eq("customer_profile_id", profileId)
      .order("deal_date", { ascending: false })
      .limit(250);

    const crmDeals: CrmDealSignal[] = [];
    if (contact?.id) {
      const { data: crmDealsData } = await adminClient
        .from("crm_deals")
        .select("amount, created_at, crm_deal_stages!inner(is_closed_won)")
        .eq("primary_contact_id", contact.id)
        .is("deleted_at", null)
        .limit(250);

      for (const row of crmDealsData ?? []) {
        const record = row as Record<string, unknown>;
        const stageRaw = record.crm_deal_stages as
          | { is_closed_won?: boolean }
          | Array<{ is_closed_won?: boolean }>
          | null;
        const closedWon = Array.isArray(stageRaw)
          ? stageRaw[0]?.is_closed_won === true
          : stageRaw?.is_closed_won === true;

        crmDeals.push({
          amount: (record.amount as number | null) ?? null,
          created_at: String(record.created_at ?? new Date().toISOString()),
          stage_is_closed_won: closedWon,
        });
      }
    }

    const metrics = computeCustomerDnaMetrics(
      (historyData ?? []) as DealHistorySignal[],
      crmDeals,
    );
    const persona = classifyPersona(metrics);

    const { data: modelRow } = await adminClient
      .from("pricing_persona_models")
      .select("model_version")
      .eq("model_name", "persona_classifier")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const dataBadges = collectCustomerDnaBadges(
      metrics.totalDeals,
      Boolean(profileRow.hubspot_contact_id || contact?.hubspot_contact_id),
    );

    const nextMetadata = {
      ...(profileRow.metadata ?? {}),
      persona_reasoning: persona.reasoning,
      data_badges: dataBadges,
      last_dna_refresh_at: new Date().toISOString(),
      source: caller.isServiceRole ? "service" : "user",
    };

    const { data: updated, error: updateError } = await adminClient
      .from("customer_profiles_extended")
      .update({
        pricing_persona: persona.persona,
        persona_confidence: persona.confidence,
        persona_model_version: (modelRow?.model_version as string | null) ??
          "v1",
        lifetime_value: metrics.totalLifetimeValue,
        total_deals: metrics.totalDeals,
        avg_deal_size: metrics.avgDealSize,
        avg_discount_pct: metrics.avgDiscountPct,
        avg_days_to_close: metrics.avgDaysToClose,
        attachment_rate: metrics.attachmentRate,
        service_contract_rate: metrics.serviceContractRate,
        last_interaction_at: metrics.lastInteractionAt,
        price_sensitivity_score: metrics.priceSensitivityScore,
        metadata: nextMetadata,
      })
      .eq("id", profileId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return fail({
        origin,
        status: 500,
        code: "DB_WRITE_FAILED",
        message: "Failed to update customer DNA profile.",
        details: { reason: updateError?.message },
      });
    }

    return ok(
      mapCustomerProfileDto({
        row: updated as CustomerProfileRow,
        role: caller.role,
        isServiceRole: caller.isServiceRole,
        includeFleet: false,
        fleet: [],
        dataBadges,
      }),
      { origin },
    );
  } catch (error) {
    captureEdgeException(error, { fn: "customer-dna-update", req });
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
