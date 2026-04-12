import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  classifyPersona,
  computeCustomerDnaMetrics,
  type CrmDealSignal,
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
    refresh_status: "fresh",
    refresh_job_id: null,
    source: params.isServiceRole ? "service" : "user",
  };

  const { data: updated, error: updateError } = await adminClient
    .from("customer_profiles_extended")
    .update({
      pricing_persona: persona.persona,
      persona_confidence: persona.confidence,
      persona_model_version: (modelRow?.model_version as string | null) ?? "v1",
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
