import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ensureInternalId,
  findMappedInternalId,
  saveExternalIdMapping,
} from "./crm-external-id-map.ts";
import { resolveDealStage } from "./crm-stage-resolver.ts";

export { findMappedInternalId };

export interface UpsertHubSpotCompanyInput {
  supabase: SupabaseClient;
  workspaceId: string;
  hubspotCompanyId: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertHubSpotContactInput {
  supabase: SupabaseClient;
  workspaceId: string;
  hubspotContactId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  primaryCompanyId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpsertHubSpotDealInput {
  supabase: SupabaseClient;
  workspaceId: string;
  hubspotDealId: string;
  name: string;
  hubspotStageId?: string | null;
  amount?: number | null;
  expectedCloseOn?: string | null;
  companyId?: string | null;
  primaryContactId?: string | null;
  metadata?: Record<string, unknown>;
  mode: "webhook" | "import";
}

export interface UpsertHubSpotDealResult {
  id: string;
  fallbackStageUsed: boolean;
  fallbackReason: string | null;
  stageName: string;
}

export interface UpsertCrmActivityInput {
  supabase: SupabaseClient;
  workspaceId: string;
  externalActivityId: string;
  body: string;
  occurredAt: string;
  dealId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, unknown>;
}

function normalizeText(
  value: string | null | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export async function upsertHubSpotCompany(
  input: UpsertHubSpotCompanyInput,
): Promise<string> {
  const internalId = await ensureInternalId({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    objectType: "company",
    externalId: input.hubspotCompanyId,
    table: "crm_companies",
    hubspotColumn: "hubspot_company_id",
  });

  const { error } = await input.supabase.from("crm_companies").upsert(
    {
      id: internalId,
      workspace_id: input.workspaceId,
      name: normalizeText(input.name, `Company ${input.hubspotCompanyId}`),
      hubspot_company_id: input.hubspotCompanyId,
      address_line_1: input.addressLine1 ?? null,
      address_line_2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postal_code: input.postalCode ?? null,
      country: input.country ?? null,
      metadata: input.metadata ?? {},
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Failed to upsert crm_companies row: ${error.message}`);
  }

  await saveExternalIdMapping(
    input.supabase,
    input.workspaceId,
    "company",
    input.hubspotCompanyId,
    internalId,
  );
  return internalId;
}

export async function upsertHubSpotContact(
  input: UpsertHubSpotContactInput,
): Promise<string> {
  const internalId = await ensureInternalId({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    objectType: "contact",
    externalId: input.hubspotContactId,
    table: "crm_contacts",
    hubspotColumn: "hubspot_contact_id",
  });

  const { error } = await input.supabase.from("crm_contacts").upsert(
    {
      id: internalId,
      workspace_id: input.workspaceId,
      first_name: normalizeText(input.firstName, "Unknown"),
      last_name: normalizeText(input.lastName, "Contact"),
      email: input.email ?? null,
      phone: input.phone ?? null,
      title: input.title ?? null,
      primary_company_id: input.primaryCompanyId ?? null,
      hubspot_contact_id: input.hubspotContactId,
      metadata: input.metadata ?? {},
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Failed to upsert crm_contacts row: ${error.message}`);
  }

  await saveExternalIdMapping(
    input.supabase,
    input.workspaceId,
    "contact",
    input.hubspotContactId,
    internalId,
  );
  return internalId;
}

export async function upsertHubSpotDeal(
  input: UpsertHubSpotDealInput,
): Promise<UpsertHubSpotDealResult> {
  const stage = await resolveDealStage(
    input.supabase,
    input.workspaceId,
    input.hubspotStageId ?? null,
    input.mode,
  );

  const internalId = await ensureInternalId({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    objectType: "deal",
    externalId: input.hubspotDealId,
    table: "crm_deals",
    hubspotColumn: "hubspot_deal_id",
  });

  const { data: existingDeal, error: existingDealError } = await input.supabase
    .from("crm_deals")
    .select("closed_at")
    .eq("id", internalId)
    .maybeSingle<{ closed_at: string | null }>();

  if (existingDealError) {
    throw new Error(`Failed to query existing crm_deals row: ${existingDealError.message}`);
  }

  const isClosedStage = stage.isClosedWon || stage.isClosedLost;
  const closedAt = isClosedStage
    ? existingDeal?.closed_at ?? new Date().toISOString()
    : null;

  const { error } = await input.supabase.from("crm_deals").upsert(
    {
      id: internalId,
      workspace_id: input.workspaceId,
      name: normalizeText(input.name, `Deal ${input.hubspotDealId}`),
      stage_id: stage.stageId,
      primary_contact_id: input.primaryContactId ?? null,
      company_id: input.companyId ?? null,
      amount: input.amount ?? null,
      expected_close_on: input.expectedCloseOn ?? null,
      closed_at: closedAt,
      hubspot_deal_id: input.hubspotDealId,
      metadata: input.metadata ?? {},
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Failed to upsert crm_deals row: ${error.message}`);
  }

  await saveExternalIdMapping(
    input.supabase,
    input.workspaceId,
    "deal",
    input.hubspotDealId,
    internalId,
  );

  return {
    id: internalId,
    fallbackStageUsed: stage.usedFallback,
    fallbackReason: stage.fallbackReason,
    stageName: stage.stageName,
  };
}

export async function upsertCrmActivity(
  input: UpsertCrmActivityInput,
): Promise<string> {
  const internalId = await ensureInternalId({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    objectType: "activity",
    externalId: input.externalActivityId,
    table: "crm_activities",
  });

  const { error } = await input.supabase.from("crm_activities").upsert(
    {
      id: internalId,
      workspace_id: input.workspaceId,
      activity_type: "note",
      body: input.body,
      occurred_at: input.occurredAt,
      deal_id: input.dealId ?? null,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      metadata: input.metadata ?? {},
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Failed to upsert crm_activities row: ${error.message}`);
  }

  await saveExternalIdMapping(
    input.supabase,
    input.workspaceId,
    "activity",
    input.externalActivityId,
    internalId,
  );
  return internalId;
}
