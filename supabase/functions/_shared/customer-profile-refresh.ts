import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  classifyPersona,
  computeCustomerDnaMetrics,
  type CrmDealSignal,
  type CustomerStreamSignals,
  type DealHistorySignal,
} from "./customer-dna-logic.ts";
import {
  cleanString,
  collectCustomerDnaBadges,
  type CustomerDnaLookupInput,
  fetchExistingCustomerProfile,
  resolveContactByLookup,
} from "./customer-dna-store.ts";
import {
  type CustomerProfileRow,
  mapCustomerProfileDto,
} from "./customer-profile-dto.ts";

export async function refreshCustomerProfileSnapshot(
  adminClient: SupabaseClient,
  params: {
    lookup: CustomerDnaLookupInput;
    actorRole: "rep" | "admin" | "manager" | "owner" | null;
    actorUserId: string | null;
    isServiceRole: boolean;
  },
): Promise<Record<string, unknown>> {
  const contact = await resolveContactByLookup(adminClient, params.lookup);
  const existing = await fetchExistingCustomerProfile(
    adminClient,
    params.lookup,
    contact,
  );

  let profileId = existing?.id ?? null;
  if (!profileId) {
    const customerName = `${contact?.first_name ?? "Unknown"} ${
      contact?.last_name ?? "Customer"
    }`.trim();

    const { data: inserted, error: insertError } = await adminClient
      .from("customer_profiles_extended")
      .insert({
        hubspot_contact_id: cleanString(params.lookup.hubspot_contact_id) ??
          contact?.hubspot_contact_id ?? null,
        intellidealer_customer_id: cleanString(
          params.lookup.intellidealer_customer_id,
        ),
        customer_name: customerName,
        company_name: null,
        // N4.1: stamp the company anchor at birth — unanchored profiles are
        // invisible to Account 360, health scoring, and stream rollups.
        crm_company_id: contact?.primary_company_id ?? null,
        metadata: {
          data_badges: ["DEMO"],
          persona_reasoning: "Profile created from partial identifiers.",
        },
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message ?? "Failed to create customer profile.");
    }

    profileId = inserted.id as string;
    if (contact?.id) {
      await adminClient
        .from("crm_contacts")
        .update({ dge_customer_profile_id: profileId })
        .eq("id", contact.id);
    }
  }

  const { data: profileData, error: profileError } = await adminClient
    .from("customer_profiles_extended")
    .select("*")
    .eq("id", profileId)
    .single();

  if (profileError || !profileData) {
    throw new Error(profileError?.message ?? "Customer profile lookup failed.");
  }

  const profileRow = profileData as CustomerProfileRow;
  const { data: historyData } = await adminClient
    .from("customer_deal_history")
    .select(
      "outcome, sold_price, discount_pct, financing_used, attachments_sold, service_contract_sold, days_to_close, deal_date",
    )
    .eq("customer_profile_id", profileId)
    .order("deal_date", { ascending: false })
    .limit(250);

  // N4.1: the company anchor drives deal + stream signals. Prefer the stored
  // profile anchor, fall back to the resolved contact's primary company, and
  // backfill the profile row when it was created before stamping existed.
  const companyId = (profileRow.crm_company_id as string | null) ??
    contact?.primary_company_id ?? null;

  const crmDeals: CrmDealSignal[] = [];
  if (companyId || contact?.id) {
    let dealsQuery = adminClient
      .from("crm_deals")
      .select("amount, created_at, crm_deal_stages!inner(is_closed_won)")
      .is("deleted_at", null)
      .limit(250);
    dealsQuery = companyId
      ? dealsQuery.eq("company_id", companyId)
      : dealsQuery.eq("primary_contact_id", contact!.id);
    const { data: crmDealsData } = await dealsQuery;

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

  // N4.1: fold the non-deal streams into the DNA on the company anchor.
  let streams: CustomerStreamSignals | undefined;
  if (companyId) {
    const [directParts, portalIds] = await Promise.all([
      adminClient
        .from("parts_orders")
        .select("total, created_at")
        .eq("crm_company_id", companyId)
        .limit(1000),
      adminClient
        .from("portal_customers")
        .select("id")
        .eq("crm_company_id", companyId),
    ]);
    const portalIdList = (portalIds.data ?? []).map((r) => r.id as string);
    const portalParts = portalIdList.length > 0
      ? await adminClient
        .from("parts_orders")
        .select("total, created_at")
        .in("portal_customer_id", portalIdList)
        .limit(1000)
      : { data: [] as Array<{ total: number | null; created_at: string }> };

    const [serviceInvoices, rentalContracts] = await Promise.all([
      adminClient
        .from("customer_invoices")
        .select("total, invoice_date, invoice_type, service_job_id, status")
        .eq("crm_company_id", companyId)
        .neq("status", "void")
        .limit(1000),
      // Billed rental history is a financial fact — include invoices from
      // soft-deleted contracts; only deleted invoices are excluded below.
      adminClient
        .from("rental_contracts")
        .select("id")
        .eq("qrm_company_id", companyId),
    ]);
    const contractIds = (rentalContracts.data ?? []).map((r) => r.id as string);
    const rentalInvoices = contractIds.length > 0
      ? await adminClient
        .from("rental_invoices")
        .select("total_cents, period_start, status")
        .in("rental_contract_id", contractIds)
        .neq("status", "void")
        .is("deleted_at", null)
        .limit(1000)
      : { data: [] as Array<{ total_cents: number | null; period_start: string; status: string }> };

    const partsRows = [...(directParts.data ?? []), ...(portalParts.data ?? [])];
    const serviceRows = (serviceInvoices.data ?? []).filter((r) =>
      r.invoice_type === "service" || r.service_job_id != null
    );
    const rentalRows = rentalInvoices.data ?? [];

    const activityDates = [
      ...partsRows.map((r) => r.created_at),
      ...serviceRows.map((r) => r.invoice_date),
      ...rentalRows.map((r) => r.period_start),
    ].filter((d): d is string => typeof d === "string");

    streams = {
      partsLifetimeTotal: partsRows.reduce((s, r) => s + (r.total ?? 0), 0),
      serviceLifetimeTotal: serviceRows.reduce((s, r) => s + (r.total ?? 0), 0),
      rentalLifetimeTotal: rentalRows.reduce((s, r) => s + (r.total_cents ?? 0), 0) / 100,
      lastActivityAt: activityDates.length > 0
        ? activityDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
        : null,
    };
  }

  const metrics = computeCustomerDnaMetrics(
    (historyData ?? []) as DealHistorySignal[],
    crmDeals,
    streams,
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
    refresh_status: "fresh",
    refresh_job_id: null,
    source: params.isServiceRole ? "service" : "user",
    lifetime_value_breakdown: {
      deals: metrics.dealLifetimeValue,
      parts: metrics.partsLifetimeValue,
      service: metrics.serviceLifetimeValue,
      rental: metrics.rentalLifetimeValue,
    },
  };

  const { data: updated, error: updateError } = await adminClient
    .from("customer_profiles_extended")
    .update({
      pricing_persona: persona.persona,
      persona_confidence: persona.confidence,
      persona_model_version: (modelRow?.model_version as string | null) ?? "v1",
      lifetime_value: metrics.totalLifetimeValue,
      crm_company_id: (profileRow.crm_company_id as string | null) ?? companyId,
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
    throw new Error(updateError?.message ?? "Failed to update customer profile.");
  }

  return mapCustomerProfileDto({
    row: updated as CustomerProfileRow,
    role: params.actorRole,
    isServiceRole: params.isServiceRole,
    includeFleet: false,
    fleet: [],
    dataBadges,
  });
}
