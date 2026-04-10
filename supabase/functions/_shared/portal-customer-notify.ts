import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface PortalCustomerNotificationInsert {
  workspace_id: string;
  portal_customer_id: string | null;
  category: "service" | "parts" | "quotes" | "fleet";
  event_type: string;
  channel: "portal" | "email" | "sms";
  title: string;
  body: string;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  metadata?: Record<string, unknown>;
  dedupe_key: string;
  sent_at?: string;
}

export function sortPortalNotifications<T extends { occurred_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

export async function insertPortalCustomerNotification(
  supabase: SupabaseClient,
  input: PortalCustomerNotificationInsert,
): Promise<"inserted" | "deduped" | "skipped"> {
  if (!input.portal_customer_id) return "skipped";

  const { error } = await supabase.from("portal_customer_notifications").insert({
    workspace_id: input.workspace_id,
    portal_customer_id: input.portal_customer_id,
    category: input.category,
    event_type: input.event_type,
    channel: input.channel,
    title: input.title,
    body: input.body,
    related_entity_type: input.related_entity_type ?? null,
    related_entity_id: input.related_entity_id ?? null,
    metadata: input.metadata ?? {},
    dedupe_key: input.dedupe_key,
    sent_at: input.sent_at ?? new Date().toISOString(),
  });

  if (!error) return "inserted";
  if ((error as { code?: string }).code === "23505") return "deduped";
  throw error;
}

export async function resolvePortalCustomerIdForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string | null> {
  const { data: job, error: jobErr } = await supabase
    .from("service_jobs")
    .select("portal_request_id, contact_id, customer_id")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr || !job) return null;

  const portalRequestId = typeof job.portal_request_id === "string" ? job.portal_request_id : null;
  if (portalRequestId) {
    const { data: requestRow } = await supabase
      .from("service_requests")
      .select("portal_customer_id")
      .eq("id", portalRequestId)
      .maybeSingle();
    if (typeof requestRow?.portal_customer_id === "string") return requestRow.portal_customer_id;
  }

  const contactId = typeof job.contact_id === "string" ? job.contact_id : null;
  if (contactId) {
    const { data: portalCustomer } = await supabase
      .from("portal_customers")
      .select("id")
      .eq("crm_contact_id", contactId)
      .limit(1)
      .maybeSingle();
    if (typeof portalCustomer?.id === "string") return portalCustomer.id;
  }

  const companyId = typeof job.customer_id === "string" ? job.customer_id : null;
  if (companyId) {
    const { data: portalCustomer } = await supabase
      .from("portal_customers")
      .select("id")
      .eq("crm_company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (typeof portalCustomer?.id === "string") return portalCustomer.id;
  }

  return null;
}
