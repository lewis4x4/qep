import { crmSupabase, type CrmDatabase } from "./crm-supabase";
import { patchCrmDealViaRouter } from "./crm-router-api";
import type {
  CrmDealBoardListInput,
  CrmDealLossFields,
  CrmDealPatchInput,
  CrmDealStage,
  CrmPageResult,
  CrmRepSafeDeal,
  CrmWeightedDeal,
} from "./types";

const DEALS_PAGE_SIZE = 100;
const DEALS_PAGE_LIMIT_MAX = 500;
const REP_SAFE_DEAL_SELECT =
  "id, workspace_id, name, stage_id, primary_contact_id, company_id, assigned_rep_id, amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, hubspot_deal_id, created_at, updated_at";
const WEIGHTED_DEAL_SELECT =
  "id, workspace_id, name, stage_id, stage_name, stage_probability, primary_contact_id, company_id, assigned_rep_id, amount, weighted_amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, hubspot_deal_id, created_at, updated_at";

type CrmDealStageRow = CrmDatabase["public"]["Tables"]["crm_deal_stages"]["Row"];
type CrmDealRow = CrmDatabase["public"]["Tables"]["crm_deals"]["Row"];
type CrmRepSafeDealRow = CrmDatabase["public"]["Views"]["crm_deals_rep_safe"]["Row"];
type CrmWeightedDealRow = CrmDatabase["public"]["Views"]["crm_deals_weighted"]["Row"];

function toRepSafeDeal(row: CrmRepSafeDealRow): CrmRepSafeDeal {
  const r = row as CrmRepSafeDealRow & {
    sla_deadline_at?: string | null;
    deposit_status?: string | null;
    deposit_amount?: number | null;
  };
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    stageId: r.stage_id,
    primaryContactId: r.primary_contact_id,
    companyId: r.company_id,
    assignedRepId: r.assigned_rep_id,
    amount: r.amount,
    expectedCloseOn: r.expected_close_on,
    nextFollowUpAt: r.next_follow_up_at,
    lastActivityAt: r.last_activity_at,
    closedAt: r.closed_at,
    hubspotDealId: r.hubspot_deal_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    slaDeadlineAt: r.sla_deadline_at ?? null,
    depositStatus: r.deposit_status ?? null,
    depositAmount: r.deposit_amount ?? null,
  };
}

function toWeightedDeal(row: CrmWeightedDealRow): CrmWeightedDeal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageProbability: row.stage_probability,
    primaryContactId: row.primary_contact_id,
    companyId: row.company_id,
    assignedRepId: row.assigned_rep_id,
    amount: row.amount,
    weightedAmount: row.weighted_amount,
    expectedCloseOn: row.expected_close_on,
    nextFollowUpAt: row.next_follow_up_at,
    lastActivityAt: row.last_activity_at,
    closedAt: row.closed_at,
    hubspotDealId: row.hubspot_deal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDealStage(row: CrmDealStageRow): CrmDealStage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    sortOrder: row.sort_order,
    probability: row.probability,
    isClosedWon: row.is_closed_won,
    isClosedLost: row.is_closed_lost,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveDealsPageSize(limit?: number): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return DEALS_PAGE_SIZE;
  }

  return Math.max(1, Math.min(Math.trunc(limit), DEALS_PAGE_LIMIT_MAX));
}

export async function listCrmDealStages(): Promise<CrmDealStage[]> {
  const { data, error } = await crmSupabase
    .from("crm_deal_stages")
    .select("id, workspace_id, name, sort_order, probability, is_closed_won, is_closed_lost, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CrmDealStageRow[]).map(toDealStage);
}

export async function listCrmOpenDealsForBoard(
  input: CrmDealBoardListInput = {}
): Promise<CrmPageResult<CrmRepSafeDeal>> {
  const stages = await listCrmDealStages();
  const openStageIds = stages
    .filter((stage) => !stage.isClosedWon && !stage.isClosedLost)
    .map((stage) => stage.id);

  if (openStageIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const pageSize = resolveDealsPageSize(input.limit);
  let query = crmSupabase
    .from("crm_deals_rep_safe")
    .select(REP_SAFE_DEAL_SELECT)
    .in("stage_id", openStageIds)
    .order("id", { ascending: true })
    .limit(pageSize + 1);

  if (input.cursor) {
    query = query.gt("id", input.cursor);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as CrmRepSafeDealRow[];
  return {
    items: rows.slice(0, pageSize).map(toRepSafeDeal),
    nextCursor: rows.length > pageSize ? rows[pageSize].id : null,
  };
}

export async function getCrmDeal(dealId: string): Promise<CrmRepSafeDeal | null> {
  const { data, error } = await crmSupabase
    .from("crm_deals_rep_safe")
    .select(REP_SAFE_DEAL_SELECT)
    .eq("id", dealId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toRepSafeDeal(data as CrmRepSafeDealRow) : null;
}

export async function getCrmDealLossFields(dealId: string): Promise<CrmDealLossFields | null> {
  const { data, error } = await crmSupabase
    .from("crm_deals")
    .select("loss_reason, competitor")
    .eq("id", dealId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const row = data as Pick<CrmDealRow, "loss_reason" | "competitor">;
  return {
    lossReason: row.loss_reason,
    competitor: row.competitor,
  };
}

export async function listRepSafeDealsForContact(contactId: string): Promise<CrmRepSafeDeal[]> {
  const { data, error } = await crmSupabase
    .from("crm_deals_rep_safe")
    .select(REP_SAFE_DEAL_SELECT)
    .eq("primary_contact_id", contactId)
    .order("expected_close_on", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CrmRepSafeDealRow[]).map(toRepSafeDeal);
}

export async function listCrmWeightedOpenDeals(): Promise<CrmWeightedDeal[]> {
  const { data, error } = await crmSupabase
    .from("crm_deals_weighted")
    .select(WEIGHTED_DEAL_SELECT)
    .order("weighted_amount", { ascending: false, nullsFirst: false })
    .order("amount", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CrmWeightedDealRow[]).map(toWeightedDeal);
}

export async function patchCrmDeal(dealId: string, input: CrmDealPatchInput): Promise<CrmRepSafeDeal> {
  const payload: CrmDealPatchInput = {};
  if (input.stageId !== undefined) payload.stageId = input.stageId;
  if (input.expectedCloseOn !== undefined) payload.expectedCloseOn = input.expectedCloseOn;
  if (input.nextFollowUpAt !== undefined) payload.nextFollowUpAt = input.nextFollowUpAt;
  if (input.closedAt !== undefined) payload.closedAt = input.closedAt;
  if (input.lossReason !== undefined) payload.lossReason = input.lossReason;
  if (input.competitor !== undefined) payload.competitor = input.competitor;
  if (input.followUpReminderSource !== undefined) {
    payload.followUpReminderSource = input.followUpReminderSource;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error("No deal fields were provided for update.");
  }

  return patchCrmDealViaRouter(dealId, payload);
}
