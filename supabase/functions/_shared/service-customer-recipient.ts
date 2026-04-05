/**
 * Resolve customer email / SMS recipient for service job outbound comms.
 *
 * Precedence (first non-empty wins):
 * 1. Job-linked CRM contact (contact_id → crm_contacts.email / .phone)
 * 2. Portal request → portal customer (portal_request_id → service_requests → portal_customers)
 * 3. Company metadata fallback (customer_id → crm_companies.metadata.email or metadata.contact_email)
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type ResolvedCustomerRecipient = {
  email: string | null;
  /** E.164-ish; may still need normalization before Twilio */
  phone: string | null;
  source:
    | "crm_contact"
    | "portal_customer"
    | "company_metadata"
    | "none";
};

function pickEmailFromMetadata(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const e = m.email ?? m.contact_email ?? m.billing_email;
  if (typeof e === "string" && e.includes("@")) return e.trim();
  return null;
}

export async function resolveCustomerRecipientForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<ResolvedCustomerRecipient> {
  const { data: job, error } = await supabase
    .from("service_jobs")
    .select("contact_id, customer_id, portal_request_id")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { email: null, phone: null, source: "none" };
  }

  const contactId = job.contact_id as string | null;
  if (contactId) {
    const { data: c } = await supabase
      .from("crm_contacts")
      .select("email, phone")
      .eq("id", contactId)
      .maybeSingle();
    const email = (c?.email as string | null)?.trim() || null;
    const phone = (c?.phone as string | null)?.trim() || null;
    if (email || phone) {
      return {
        email: email && email.includes("@") ? email : null,
        phone,
        source: "crm_contact",
      };
    }
  }

  const portalReqId = job.portal_request_id as string | null;
  if (portalReqId) {
    const { data: req } = await supabase
      .from("service_requests")
      .select("portal_customer_id")
      .eq("id", portalReqId)
      .maybeSingle();
    const pcid = req?.portal_customer_id as string | undefined;
    if (pcid) {
      const { data: pc } = await supabase
        .from("portal_customers")
        .select("email, phone")
        .eq("id", pcid)
        .maybeSingle();
      const email = (pc?.email as string | null)?.trim() || null;
      const phone = (pc?.phone as string | null)?.trim() || null;
      if (email || phone) {
        return {
          email: email && email.includes("@") ? email : null,
          phone,
          source: "portal_customer",
        };
      }
    }
  }

  const companyId = job.customer_id as string | null;
  if (companyId) {
    const { data: co } = await supabase
      .from("crm_companies")
      .select("metadata")
      .eq("id", companyId)
      .maybeSingle();
    const email = pickEmailFromMetadata(co?.metadata);
    if (email) {
      return { email, phone: null, source: "company_metadata" };
    }
  }

  return { email: null, phone: null, source: "none" };
}
