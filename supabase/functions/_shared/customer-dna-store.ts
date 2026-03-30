import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { DataBadge } from "./integration-types.ts";
import type { CustomerProfileRow } from "./customer-profile-dto.ts";

export interface CustomerDnaLookupInput {
  customer_profiles_extended_id?: string;
  hubspot_contact_id?: string;
  intellidealer_customer_id?: string;
  email?: string;
}

export interface CrmContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  hubspot_contact_id: string | null;
  dge_customer_profile_id: string | null;
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
): Promise<CrmContactRow | null> {
  const hubspotId = cleanString(body.hubspot_contact_id);
  if (hubspotId) {
    const { data } = await adminClient
      .from("crm_contacts")
      .select(
        "id, first_name, last_name, email, hubspot_contact_id, dge_customer_profile_id",
      )
      .eq("hubspot_contact_id", hubspotId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    return (data as CrmContactRow | null) ?? null;
  }

  const email = cleanString(body.email);
  if (email) {
    const { data } = await adminClient
      .from("crm_contacts")
      .select(
        "id, first_name, last_name, email, hubspot_contact_id, dge_customer_profile_id",
      )
      .ilike("email", email)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    return (data as CrmContactRow | null) ?? null;
  }

  return null;
}

export async function fetchExistingCustomerProfile(
  adminClient: SupabaseClient,
  body: CustomerDnaLookupInput,
  contact: CrmContactRow | null,
): Promise<CustomerProfileRow | null> {
  const profileId = cleanString(body.customer_profiles_extended_id) ??
    contact?.dge_customer_profile_id ?? null;
  if (profileId) {
    const { data } = await adminClient
      .from("customer_profiles_extended")
      .select("*")
      .eq("id", profileId)
      .maybeSingle();

    if (data) return data as CustomerProfileRow;
  }

  const hubspotId = cleanString(body.hubspot_contact_id) ??
    contact?.hubspot_contact_id ?? null;
  if (hubspotId) {
    const { data } = await adminClient
      .from("customer_profiles_extended")
      .select("*")
      .eq("hubspot_contact_id", hubspotId)
      .limit(1)
      .maybeSingle();

    if (data) return data as CustomerProfileRow;
  }

  const intelliId = cleanString(body.intellidealer_customer_id);
  if (intelliId) {
    const { data } = await adminClient
      .from("customer_profiles_extended")
      .select("*")
      .eq("intellidealer_customer_id", intelliId)
      .limit(1)
      .maybeSingle();

    if (data) return data as CustomerProfileRow;
  }

  return null;
}
