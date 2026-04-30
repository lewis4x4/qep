import { crmSupabase } from "./qrm-supabase";
import { dealCompositeQueryKey } from "./deal-composite-keys";
import type { Cadence, CadenceTouchpoint, QrmDealDemoSummary, NeedsAssessment } from "./deal-composite-types";
import type { QrmActivityItem, QrmCompanySummary, QrmContactSummary, QrmDealLossFields, QrmRepSafeDeal } from "./types";

export { dealCompositeQueryKey } from "./deal-composite-keys";

export interface DealCompositeBundle {
  deal: QrmRepSafeDeal;
  contact: QrmContactSummary | null;
  company: QrmCompanySummary | null;
  needsAssessment: NeedsAssessment | null;
  cadences: Cadence[];
  demos: QrmDealDemoSummary[];
  activities: QrmActivityItem[];
  lossFields: QrmDealLossFields;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function mapDealFromCompositeJson(d: Record<string, unknown>): QrmRepSafeDeal {
  return {
    id: d.id as string,
    workspaceId: d.workspace_id as string,
    name: d.name as string,
    stageId: d.stage_id as string,
    primaryContactId: (d.primary_contact_id as string | null) ?? null,
    companyId: (d.company_id as string | null) ?? null,
    assignedRepId: (d.assigned_rep_id as string | null) ?? null,
    amount: (d.amount as number | null) ?? null,
    expectedCloseOn: (d.expected_close_on as string | null) ?? null,
    nextFollowUpAt: (d.next_follow_up_at as string | null) ?? null,
    lastActivityAt: (d.last_activity_at as string | null) ?? null,
    closedAt: (d.closed_at as string | null) ?? null,
    hubspotDealId: (d.hubspot_deal_id as string | null) ?? null,
    createdAt: d.created_at as string,
    updatedAt: d.updated_at as string,
    slaDeadlineAt: (d.sla_deadline_at as string | null) ?? null,
    depositStatus: (d.deposit_status as string | null) ?? null,
    depositAmount: (d.deposit_amount as number | null) ?? null,
    sortPosition: (d.sort_position as number | null) ?? null,
    marginPct: (d.margin_pct as number | null) ?? null,
  };
}

function mapContactFromJson(j: Record<string, unknown>): QrmContactSummary {
  return {
    id: j.id as string,
    workspaceId: j.workspace_id as string,
    dgeCustomerProfileId: (j.dge_customer_profile_id as string | null) ?? null,
    firstName: j.first_name as string,
    lastName: j.last_name as string,
    email: (j.email as string | null) ?? null,
    phone: (j.phone as string | null) ?? null,
    title: (j.title as string | null) ?? null,
    primaryCompanyId: (j.primary_company_id as string | null) ?? null,
    assignedRepId: (j.assigned_rep_id as string | null) ?? null,
    mergedIntoContactId: (j.merged_into_contact_id as string | null) ?? null,
    createdAt: j.created_at as string,
    updatedAt: j.updated_at as string,
  };
}

function mapCompanyFromJson(j: Record<string, unknown>): QrmCompanySummary {
  return {
    id: j.id as string,
    workspaceId: j.workspace_id as string,
    name: j.name as string,
    parentCompanyId: (j.parent_company_id as string | null) ?? null,
    assignedRepId: (j.assigned_rep_id as string | null) ?? null,
    legacyCustomerNumber: (j.legacy_customer_number as string | null) ?? null,
    search1: (j.search_1 as string | null) ?? null,
    search2: (j.search_2 as string | null) ?? null,
    addressLine1: (j.address_line_1 as string | null) ?? null,
    addressLine2: (j.address_line_2 as string | null) ?? null,
    city: (j.city as string | null) ?? null,
    state: (j.state as string | null) ?? null,
    postalCode: (j.postal_code as string | null) ?? null,
    country: (j.country as string | null) ?? null,
    createdAt: j.created_at as string,
    updatedAt: j.updated_at as string,
  };
}

function mapActivityFromJson(row: Record<string, unknown>): QrmActivityItem {
  const meta = row.metadata;
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    activityType: row.activity_type as QrmActivityItem["activityType"],
    body: (row.body as string | null) ?? null,
    occurredAt: row.occurred_at as string,
    contactId: (row.contact_id as string | null) ?? null,
    companyId: (row.company_id as string | null) ?? null,
    dealId: (row.deal_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    metadata:
      meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function normalizeCadence(raw: Record<string, unknown>): Cadence {
  const tp = raw.touchpoints ?? raw.follow_up_touchpoints;
  const touchpoints = Array.isArray(tp) ? tp : [];
  return {
    id: raw.id as string,
    cadence_type: raw.cadence_type as Cadence["cadence_type"],
    status: raw.status as string,
    started_at: raw.started_at as string,
    follow_up_touchpoints: touchpoints.filter(isRecord).map((t) => ({
      id: t.id as string,
      touchpoint_type: t.touchpoint_type as string,
      scheduled_date: t.scheduled_date as string,
      purpose: t.purpose as string,
      suggested_message: (t.suggested_message as string | null) ?? null,
      value_type: (t.value_type as string | null) ?? null,
      status: t.status as CadenceTouchpoint["status"],
      completed_at: (t.completed_at as string | null) ?? null,
      delivery_method: (t.delivery_method as string | null) ?? null,
    })),
  };
}

function normalizeDemo(raw: Record<string, unknown>): QrmDealDemoSummary {
  const { inspections: _i, ...rest } = raw;
  return rest as unknown as QrmDealDemoSummary;
}

/**
 * Single RPC round-trip for deal detail shell data (replaces parallel deal/contact/company/
 * activities/loss + card queries). Equipment linking still uses crm-router-api separately.
 */
export async function fetchDealComposite(dealId: string): Promise<DealCompositeBundle | null> {
  const { data, error } = await (
    crmSupabase as unknown as {
      rpc(
        fn: "get_deal_composite",
        args: { p_deal_id: string },
      ): Promise<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc("get_deal_composite", { p_deal_id: dealId });

  if (error) {
    throw new Error(error.message);
  }

  if (!isRecord(data)) {
    return null;
  }

  if (typeof data.error === "string") {
    return null;
  }

  const dealJson = data.deal;
  if (!isRecord(dealJson)) {
    return null;
  }

  const contactJson = data.contact;
  const companyJson = data.company;
  const assessmentJson = data.needs_assessment;
  const cadencesJson = data.cadences;
  const demosJson = data.demos;
  const activitiesJson = data.activities;
  const lossJson = data.loss_fields;

  const lossFields: QrmDealLossFields = isRecord(lossJson)
    ? {
        lossReason: (lossJson.loss_reason as string | null) ?? null,
        competitor: (lossJson.competitor as string | null) ?? null,
      }
    : { lossReason: null, competitor: null };

  const cadences: Cadence[] = Array.isArray(cadencesJson)
    ? cadencesJson.filter(isRecord).map((c) => normalizeCadence(c))
    : [];

  const demos: QrmDealDemoSummary[] = Array.isArray(demosJson)
    ? demosJson.filter(isRecord).map((d) => normalizeDemo(d))
    : [];

  const activities: QrmActivityItem[] = Array.isArray(activitiesJson)
    ? activitiesJson.filter(isRecord).map((a) => mapActivityFromJson(a))
    : [];

  return {
    deal: mapDealFromCompositeJson(dealJson),
    contact: isRecord(contactJson) ? mapContactFromJson(contactJson) : null,
    company: isRecord(companyJson) ? mapCompanyFromJson(companyJson) : null,
    needsAssessment: isRecord(assessmentJson) ? (assessmentJson as unknown as NeedsAssessment) : null,
    cadences,
    demos,
    activities,
    lossFields,
  };
}
