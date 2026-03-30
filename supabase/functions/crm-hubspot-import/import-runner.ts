import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  getValidHubSpotAccessToken,
  requestHubSpot,
  resolveCanonicalHubSpotResolution,
} from "../_shared/hubspot-client.ts";
import {
  findMappedInternalId,
  upsertHubSpotCompany,
  upsertHubSpotContact,
  upsertHubSpotDeal,
} from "../_shared/crm-hubspot-sync.ts";
import { SlidingWindowRateLimiter } from "../_shared/hubspot-rate-limiter.ts";
import {
  type HubSpotCompanyRecord,
  type HubSpotContactRecord,
  type HubSpotDealRecord,
  type HubSpotPage,
  type ImportState,
  nextAfterToken,
  parseAmount,
  parseCloseDate,
} from "./types.ts";
import { appendImportError, updateRun } from "./run-state.ts";

type ImportSupabase = SupabaseClient<any, "public", any>;

const HUBSPOT_PAGE_LIMIT = 100;
const HUBSPOT_RATE_LIMITER = new SlidingWindowRateLimiter(100, 10_000);

async function fetchHubSpotPage<T>(
  hubId: string,
  token: string,
  operationKey: string,
  path: string,
): Promise<HubSpotPage<T>> {
  await HUBSPOT_RATE_LIMITER.waitTurn();
  const response = await requestHubSpot({
    hubId,
    token,
    operationKey,
    path,
  });

  if (!response.ok) {
    throw new Error(
      `HubSpot ${operationKey} failed with status ${response.status}`,
    );
  }

  return await response.json() as HubSpotPage<T>;
}

export async function runHubSpotImport(
  supabase: ImportSupabase,
  state: ImportState,
): Promise<void> {
  const { data: binding } = await supabase
    .from("workspace_hubspot_portal")
    .select("hub_id")
    .eq("workspace_id", state.workspaceId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ hub_id: string }>();

  if (!binding?.hub_id) {
    throw new Error(
      "No active workspace_hubspot_portal binding found for workspace.",
    );
  }

  const canonical = await resolveCanonicalHubSpotResolution(
    supabase,
    binding.hub_id,
  );
  if (!canonical.context) {
    throw new Error(`Canonical HubSpot context unavailable: ${canonical.code}`);
  }

  const token = await getValidHubSpotAccessToken(supabase, canonical.context);
  if (!token) {
    throw new Error("Unable to obtain valid HubSpot token.");
  }

  while (!state.checkpoint.companiesDone) {
    const after = state.checkpoint.companiesAfter;
    const page = await fetchHubSpotPage<HubSpotCompanyRecord>(
      binding.hub_id,
      token,
      "crm_import_companies",
      `/crm/v3/objects/companies?limit=${HUBSPOT_PAGE_LIMIT}${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }&properties=name,address,address2,city,state,zip,country,hs_object_id`,
    );

    for (const row of page.results) {
      try {
        await upsertHubSpotCompany({
          supabase,
          workspaceId: state.workspaceId,
          hubspotCompanyId: row.id,
          name: row.properties?.name ?? `Company ${row.id}`,
          addressLine1: row.properties?.address ?? null,
          addressLine2: row.properties?.address2 ?? null,
          city: row.properties?.city ?? null,
          state: row.properties?.state ?? null,
          postalCode: row.properties?.zip ?? null,
          country: row.properties?.country ?? null,
          metadata: { source: "hubspot_import" },
        });
        state.companiesProcessed += 1;
      } catch (error) {
        await appendImportError(
          supabase,
          state,
          "company",
          row.id,
          "upsert_failed",
          error instanceof Error ? error.message : String(error),
          row.properties ?? {},
        );
      }
    }

    state.checkpoint.companiesAfter = nextAfterToken(page);
    state.checkpoint.companiesDone = state.checkpoint.companiesAfter === null;
    await updateRun(supabase, state);
  }

  while (!state.checkpoint.contactsDone) {
    const after = state.checkpoint.contactsAfter;
    const page = await fetchHubSpotPage<HubSpotContactRecord>(
      binding.hub_id,
      token,
      "crm_import_contacts",
      `/crm/v3/objects/contacts?limit=${HUBSPOT_PAGE_LIMIT}${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }&properties=firstname,lastname,email,phone,jobtitle,associatedcompanyid,hs_object_id`,
    );

    for (const row of page.results) {
      try {
        const companyExternalId = row.properties?.associatedcompanyid ?? null;
        const primaryCompanyId = companyExternalId
          ? await findMappedInternalId(
            supabase,
            state.workspaceId,
            "company",
            companyExternalId,
          )
          : null;

        await upsertHubSpotContact({
          supabase,
          workspaceId: state.workspaceId,
          hubspotContactId: row.id,
          firstName: row.properties?.firstname ?? "Unknown",
          lastName: row.properties?.lastname ?? "Contact",
          email: row.properties?.email ?? null,
          phone: row.properties?.phone ?? null,
          title: row.properties?.jobtitle ?? null,
          primaryCompanyId,
          metadata: { source: "hubspot_import" },
        });

        state.contactsProcessed += 1;
      } catch (error) {
        await appendImportError(
          supabase,
          state,
          "contact",
          row.id,
          "upsert_failed",
          error instanceof Error ? error.message : String(error),
          row.properties ?? {},
        );
      }
    }

    state.checkpoint.contactsAfter = nextAfterToken(page);
    state.checkpoint.contactsDone = state.checkpoint.contactsAfter === null;
    await updateRun(supabase, state);
  }

  while (!state.checkpoint.dealsDone) {
    const after = state.checkpoint.dealsAfter;
    const page = await fetchHubSpotPage<HubSpotDealRecord>(
      binding.hub_id,
      token,
      "crm_import_deals",
      `/crm/v3/objects/deals?limit=${HUBSPOT_PAGE_LIMIT}${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }&properties=dealname,dealstage,amount,closedate,hubspot_owner_id,hs_object_id&associations=contacts,companies`,
    );

    for (const row of page.results) {
      try {
        const contactExternalId = row.associations?.contacts?.results?.[0]?.id;
        const companyExternalId = row.associations?.companies?.results?.[0]?.id;

        const primaryContactId = contactExternalId
          ? await findMappedInternalId(
            supabase,
            state.workspaceId,
            "contact",
            String(contactExternalId),
          )
          : null;

        const companyId = companyExternalId
          ? await findMappedInternalId(
            supabase,
            state.workspaceId,
            "company",
            String(companyExternalId),
          )
          : null;

        const deal = await upsertHubSpotDeal({
          supabase,
          workspaceId: state.workspaceId,
          hubspotDealId: row.id,
          name: row.properties?.dealname ?? `Deal ${row.id}`,
          hubspotStageId: row.properties?.dealstage ?? null,
          amount: parseAmount(row.properties?.amount),
          expectedCloseOn: parseCloseDate(row.properties?.closedate),
          primaryContactId,
          companyId,
          metadata: {
            source: "hubspot_import",
            hubspot_owner_id: row.properties?.hubspot_owner_id ?? null,
          },
          mode: "import",
        });

        if (deal.fallbackStageUsed) {
          await appendImportError(
            supabase,
            state,
            "deal",
            row.id,
            "stage_fallback",
            `Deal stage defaulted to \"${deal.stageName}\" (${deal.fallbackReason}).`,
            { hubspot_stage_id: row.properties?.dealstage ?? null },
          );
        }

        state.dealsProcessed += 1;
      } catch (error) {
        await appendImportError(
          supabase,
          state,
          "deal",
          row.id,
          "upsert_failed",
          error instanceof Error ? error.message : String(error),
          row.properties ?? {},
        );
      }
    }

    state.checkpoint.dealsAfter = nextAfterToken(page);
    state.checkpoint.dealsDone = state.checkpoint.dealsAfter === null;
    await updateRun(supabase, state);
  }
}
