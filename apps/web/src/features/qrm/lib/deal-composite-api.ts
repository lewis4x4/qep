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

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
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
    cell: (j.cell as string | null) ?? null,
    directPhone: (j.direct_phone as string | null) ?? null,
    birthDate: (j.birth_date as string | null) ?? null,
    smsOptIn: (j.sms_opt_in as boolean | null) ?? null,
    title: (j.title as string | null) ?? null,
    primaryCompanyId: (j.primary_company_id as string | null) ?? null,
    assignedRepId: (j.assigned_rep_id as string | null) ?? null,
    mergedIntoContactId: (j.merged_into_contact_id as string | null) ?? null,
    sourceCustomerNumber: null,
    sourceContactNumber: null,
    sourceStatusCode: null,
    sourceSalespersonCode: null,
    myDealerUser: null,
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
    status: (j.status as string | null) ?? null,
    productCategory: (j.product_category as QrmCompanySummary["productCategory"]) ?? null,
    arType: (j.ar_type as QrmCompanySummary["arType"]) ?? null,
    paymentTermsCode: (j.payment_terms_code as string | null) ?? null,
    termsCode: (j.terms_code as string | null) ?? null,
    territoryCode: (j.territory_code as string | null) ?? null,
    pricingLevel: (j.pricing_level as number | null) ?? null,
    doNotContact: (j.do_not_contact as boolean | null) ?? null,
    optOutSalePi: (j.opt_out_sale_pi as boolean | null) ?? null,
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
  return {
    id: raw.id as string,
    status: raw.status as string,
    equipment_category: stringOrNull(raw.equipment_category),
    max_hours: typeof raw.max_hours === "number" ? raw.max_hours : 0,
    starting_hours: numberOrNull(raw.starting_hours),
    ending_hours: numberOrNull(raw.ending_hours),
    hours_used: numberOrNull(raw.hours_used),
    total_demo_cost: numberOrNull(raw.total_demo_cost),
    scheduled_date: stringOrNull(raw.scheduled_date),
    followup_due_at: stringOrNull(raw.followup_due_at),
    followup_completed: typeof raw.followup_completed === "boolean" ? raw.followup_completed : false,
    customer_decision: stringOrNull(raw.customer_decision),
    needs_assessment_complete: typeof raw.needs_assessment_complete === "boolean" ? raw.needs_assessment_complete : false,
    quote_presented: typeof raw.quote_presented === "boolean" ? raw.quote_presented : false,
    buying_intent_confirmed: typeof raw.buying_intent_confirmed === "boolean" ? raw.buying_intent_confirmed : false,
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
  };
}

function normalizeNeedsAssessment(raw: Record<string, unknown>): NeedsAssessment {
  return {
    id: raw.id as string,
    application: stringOrNull(raw.application),
    work_type: stringOrNull(raw.work_type),
    terrain_material: stringOrNull(raw.terrain_material),
    current_equipment: stringOrNull(raw.current_equipment),
    current_equipment_issues: stringOrNull(raw.current_equipment_issues),
    machine_interest: stringOrNull(raw.machine_interest),
    attachments_needed: stringArrayOrNull(raw.attachments_needed),
    brand_preference: stringOrNull(raw.brand_preference),
    timeline_description: stringOrNull(raw.timeline_description),
    timeline_urgency: stringOrNull(raw.timeline_urgency),
    budget_type: stringOrNull(raw.budget_type),
    budget_amount: numberOrNull(raw.budget_amount),
    monthly_payment_target: numberOrNull(raw.monthly_payment_target),
    financing_preference: stringOrNull(raw.financing_preference),
    has_trade_in: typeof raw.has_trade_in === "boolean" ? raw.has_trade_in : false,
    trade_in_details: stringOrNull(raw.trade_in_details),
    is_decision_maker: booleanOrNull(raw.is_decision_maker),
    decision_maker_name: stringOrNull(raw.decision_maker_name),
    next_step: stringOrNull(raw.next_step),
    entry_method: typeof raw.entry_method === "string" ? raw.entry_method : "unknown",
    qrm_narrative: stringOrNull(raw.qrm_narrative),
    completeness_pct: numberOrNull(raw.completeness_pct),
    fields_populated: typeof raw.fields_populated === "number" ? raw.fields_populated : 0,
    fields_total: typeof raw.fields_total === "number" ? raw.fields_total : 0,
  };
}

/**
 * Single RPC round-trip for deal detail shell data (replaces parallel deal/contact/company/
 * activities/loss + card queries). Equipment linking still uses crm-router-api separately.
 */
export async function fetchDealComposite(dealId: string): Promise<DealCompositeBundle | null> {
  const { data, error } = await crmSupabase.rpc("get_deal_composite", { p_deal_id: dealId });

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

  const cadences: Cadence[] = toRecordArray(cadencesJson).map((c) => normalizeCadence(c));

  const demos: QrmDealDemoSummary[] = toRecordArray(demosJson).map((d) => normalizeDemo(d));

  const activities: QrmActivityItem[] = toRecordArray(activitiesJson).map((a) => mapActivityFromJson(a));

  return {
    deal: mapDealFromCompositeJson(dealJson),
    contact: isRecord(contactJson) ? mapContactFromJson(contactJson) : null,
    company: isRecord(companyJson) ? mapCompanyFromJson(companyJson) : null,
    needsAssessment: isRecord(assessmentJson) ? normalizeNeedsAssessment(assessmentJson) : null,
    cadences,
    demos,
    activities,
    lossFields,
  };
}
