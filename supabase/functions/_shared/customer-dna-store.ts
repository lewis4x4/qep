import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { DataBadge } from "./integration-types.ts";
import type { CustomerProfileRow } from "./customer-profile-dto.ts";

export interface CustomerDnaLookupInput {
  workspace_id?: string;
  customer_profiles_extended_id?: string;
  hubspot_contact_id?: string;
  intellidealer_customer_id?: string;
  email?: string;
}

export interface CrmContactRow {
  id: string;
  workspace_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  hubspot_contact_id: string | null;
  dge_customer_profile_id: string | null;
  primary_company_id: string | null;
}

export class CustomerDnaWorkspaceError extends Error {
  constructor(
    message = "Customer DNA target is outside the authorized workspace.",
  ) {
    super(message);
    this.name = "CustomerDnaWorkspaceError";
  }
}

export class CustomerDnaTargetNotFoundError extends Error {
  constructor(
    message = "No customer target was found in the authorized workspace.",
  ) {
    super(message);
    this.name = "CustomerDnaTargetNotFoundError";
  }
}

export class CustomerDnaStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerDnaStoreError";
  }
}

function assertNoStoreError(
  error: { message?: string } | null,
  operation: string,
): void {
  if (error) {
    throw new CustomerDnaStoreError(
      `${operation}: ${error.message ?? "database request failed"}`,
    );
  }
}

export function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function collectCustomerDnaBadges(
  totalDeals: number,
  hasHubspotContact: boolean,
): DataBadge[] {
  const badges: DataBadge[] = [];
  if (!hasHubspotContact || totalDeals === 0) badges.push("DEMO");
  if (totalDeals > 0 && totalDeals < 3) badges.push("ESTIMATED");
  if (totalDeals === 0) badges.push("LIMITED_MARKET_DATA");
  if (badges.length === 0) badges.push("LIVE");
  return [...new Set(badges)];
}

export async function resolveContactByLookup(
  adminClient: SupabaseClient,
  body: CustomerDnaLookupInput,
  workspaceId: string,
): Promise<CrmContactRow | null> {
  const hubspotId = cleanString(body.hubspot_contact_id);
  const email = cleanString(body.email);
  const candidateSets: Array<{ source: string; rows: CrmContactRow[] }> = [];

  if (hubspotId) {
    const { data, error } = await adminClient
      .from("crm_contacts")
      .select(
        "id, workspace_id, first_name, last_name, email, hubspot_contact_id, dge_customer_profile_id, primary_company_id",
      )
      .eq("workspace_id", workspaceId)
      .eq("hubspot_contact_id", hubspotId)
      .is("deleted_at", null)
      .limit(50);

    assertNoStoreError(error, "Customer contact HubSpot lookup failed");
    candidateSets.push({
      source: "HubSpot identifier",
      rows: (data ?? []) as CrmContactRow[],
    });
  }

  if (email) {
    const { data, error } = await adminClient
      .from("crm_contacts")
      .select(
        "id, workspace_id, first_name, last_name, email, hubspot_contact_id, dge_customer_profile_id, primary_company_id",
      )
      .eq("workspace_id", workspaceId)
      .ilike("email", email)
      .is("deleted_at", null)
      .limit(50);

    assertNoStoreError(error, "Customer contact email lookup failed");
    candidateSets.push({
      source: "email identifier",
      rows: (data ?? []) as CrmContactRow[],
    });
  }

  if (candidateSets.length === 0) return null;

  for (const candidates of candidateSets) {
    if (candidates.rows.length > 1) {
      throw new CustomerDnaStoreError(
        `Multiple active contacts in the authorized workspace share the ${candidates.source}.`,
      );
    }
  }

  if (
    candidateSets.length > 1 &&
    candidateSets.some((candidates) => candidates.rows.length === 0) &&
    candidateSets.some((candidates) => candidates.rows.length === 1)
  ) {
    throw new CustomerDnaStoreError(
      "Customer identifiers do not resolve to the same contact in the authorized workspace.",
    );
  }

  const resolved = candidateSets
    .flatMap((candidates) => candidates.rows)
    .reduce(
      (byId, candidate) => byId.set(candidate.id, candidate),
      new Map<string, CrmContactRow>(),
    );
  if (resolved.size > 1) {
    throw new CustomerDnaStoreError(
      "Customer identifiers resolve to different contacts in the authorized workspace.",
    );
  }

  return resolved.values().next().value ?? null;
}

export async function assertCrmCompanyWorkspace(
  adminClient: SupabaseClient,
  companyId: string,
  workspaceId: string,
): Promise<void> {
  const { data, error } = await adminClient
    .from("crm_companies")
    .select("id")
    .eq("id", companyId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  assertNoStoreError(error, "Customer company workspace lookup failed");

  if (!data) throw new CustomerDnaWorkspaceError();
}

async function assertCustomerProfileWorkspace(
  adminClient: SupabaseClient,
  profile: CustomerProfileRow,
  contact: CrmContactRow | null,
  workspaceId: string,
): Promise<CustomerProfileRow> {
  // A persisted company anchor is authoritative. A contact link may only
  // establish tenancy for legacy profiles that do not yet have one; it must
  // never override a conflicting company/workspace relationship.
  if (profile.crm_company_id) {
    await assertCrmCompanyWorkspace(
      adminClient,
      profile.crm_company_id,
      workspaceId,
    );
    if (contact && !contact.primary_company_id) {
      throw new CustomerDnaWorkspaceError(
        "A companyless contact cannot adopt a company-anchored customer profile.",
      );
    }
    if (
      contact?.primary_company_id &&
      contact.primary_company_id !== profile.crm_company_id
    ) {
      throw new CustomerDnaWorkspaceError(
        "Customer contact and profile company anchors conflict.",
      );
    }
    return profile;
  }

  const { data: targetLink, error: targetLinkError } = await adminClient
    .from("crm_contacts")
    .select("id")
    .eq("dge_customer_profile_id", profile.id)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  assertNoStoreError(
    targetLinkError,
    "Customer profile target contact-anchor lookup failed",
  );
  if (!targetLink) throw new CustomerDnaWorkspaceError();

  const { data: foreignLink, error: foreignLinkError } = await adminClient
    .from("crm_contacts")
    .select("id")
    .eq("dge_customer_profile_id", profile.id)
    .neq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  assertNoStoreError(
    foreignLinkError,
    "Customer profile foreign contact-anchor lookup failed",
  );
  if (foreignLink) throw new CustomerDnaWorkspaceError();
  return profile;
}

export async function fetchExistingCustomerProfile(
  adminClient: SupabaseClient,
  body: CustomerDnaLookupInput,
  contact: CrmContactRow | null,
  workspaceId: string,
): Promise<CustomerProfileRow | null> {
  const authorizedCandidates = new Map<string, CustomerProfileRow>();
  const requestedHubspotId = cleanString(body.hubspot_contact_id) ??
    contact?.hubspot_contact_id ?? null;
  const requestedIntelliId = cleanString(body.intellidealer_customer_id);

  const addExplicitProfile = async (
    profileId: string,
    source: string,
  ): Promise<void> => {
    const { data, error } = await adminClient
      .from("customer_profiles_extended")
      .select("*")
      .eq("id", profileId)
      .maybeSingle();

    assertNoStoreError(error, `Customer profile ${source} lookup failed`);

    if (data) {
      const authorized = await assertCustomerProfileWorkspace(
        adminClient,
        data as CustomerProfileRow,
        contact,
        workspaceId,
      );
      if (
        requestedHubspotId && authorized.hubspot_contact_id &&
        requestedHubspotId !== authorized.hubspot_contact_id
      ) {
        throw new CustomerDnaStoreError(
          "Explicit customer profile has a conflicting HubSpot identity.",
        );
      }
      if (
        requestedIntelliId && authorized.intellidealer_customer_id &&
        requestedIntelliId !== authorized.intellidealer_customer_id
      ) {
        throw new CustomerDnaStoreError(
          "Explicit customer profile has a conflicting IntelliDealer identity.",
        );
      }
      authorizedCandidates.set(authorized.id, authorized);
    }
  };

  const requestedProfileId = cleanString(body.customer_profiles_extended_id);
  if (requestedProfileId) {
    await addExplicitProfile(requestedProfileId, "ID");
  }
  if (
    contact?.dge_customer_profile_id &&
    contact.dge_customer_profile_id !== requestedProfileId
  ) {
    await addExplicitProfile(contact.dge_customer_profile_id, "contact link");
  }

  const addIdentifierCandidates = async (
    column: "hubspot_contact_id" | "intellidealer_customer_id",
    identifier: string,
    label: string,
  ): Promise<void> => {
    const { data, error } = await adminClient
      .from("customer_profiles_extended")
      .select("*")
      .eq(column, identifier)
      .limit(50);
    assertNoStoreError(error, `Customer profile ${label} lookup failed`);

    const matches: CustomerProfileRow[] = [];
    for (const candidate of (data ?? []) as CustomerProfileRow[]) {
      try {
        matches.push(
          await assertCustomerProfileWorkspace(
            adminClient,
            candidate,
            contact,
            workspaceId,
          ),
        );
      } catch (error) {
        if (!(error instanceof CustomerDnaWorkspaceError)) throw error;
      }
    }
    if (matches.length > 1) {
      throw new CustomerDnaStoreError(
        `Multiple workspace-authorized profiles share the ${label} identifier.`,
      );
    }
    for (const match of matches) authorizedCandidates.set(match.id, match);
  };

  if (requestedHubspotId) {
    await addIdentifierCandidates(
      "hubspot_contact_id",
      requestedHubspotId,
      "HubSpot",
    );
  }

  if (requestedIntelliId) {
    await addIdentifierCandidates(
      "intellidealer_customer_id",
      requestedIntelliId,
      "IntelliDealer",
    );
  }

  if (authorizedCandidates.size > 1) {
    throw new CustomerDnaStoreError(
      "Customer identifiers resolve to different profiles in the authorized workspace.",
    );
  }
  return authorizedCandidates.values().next().value ?? null;
}
