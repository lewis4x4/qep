import { crmSupabase, type QrmDatabase } from "./qrm-supabase";
import { patchCrmDealViaRouter } from "./qrm-router-api";
import type {
  QrmDealBoardListInput,
  QrmDealLossFields,
  QrmDealPatchInput,
  QrmDealStage,
  QrmPageResult,
  QrmRepSafeDeal,
  QrmWeightedDeal,
} from "./types";

const DEALS_PAGE_SIZE = 100;
const DEALS_PAGE_LIMIT_MAX = 500;
const REP_SAFE_DEAL_SELECT =
  "id, workspace_id, name, stage_id, primary_contact_id, company_id, assigned_rep_id, amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, hubspot_deal_id, created_at, updated_at, sort_position, margin_pct, deposit_status, deposit_amount, sla_deadline_at";
const WEIGHTED_DEAL_SELECT =
  "id, workspace_id, name, stage_id, stage_name, stage_probability, primary_contact_id, company_id, assigned_rep_id, amount, weighted_amount, expected_close_on, next_follow_up_at, last_activity_at, closed_at, hubspot_deal_id, created_at, updated_at";

type QrmDealStageRow = QrmDatabase["public"]["Tables"]["crm_deal_stages"]["Row"];
type QrmDealRow = QrmDatabase["public"]["Tables"]["crm_deals"]["Row"];
type QrmRepSafeDealRow = QrmDatabase["public"]["Views"]["crm_deals_rep_safe"]["Row"];
type QrmWeightedDealRow = QrmDatabase["public"]["Views"]["crm_deals_weighted"]["Row"];

function toRepSafeDeal(row: QrmRepSafeDealRow): QrmRepSafeDeal {
  // Optional fallbacks for cached rows written before migration 254 landed.
  const r = row as QrmRepSafeDealRow & {
    sla_deadline_at?: string | null;
    deposit_status?: string | null;
    deposit_amount?: number | null;
    sort_position?: number | null;
    margin_pct?: number | null;
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
    sortPosition: r.sort_position ?? null,
    marginPct: r.margin_pct ?? null,
  };
}

function toWeightedDeal(row: QrmWeightedDealRow): QrmWeightedDeal {
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

function toDealStage(row: QrmDealStageRow): QrmDealStage {
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

export async function listCrmDealStages(): Promise<QrmDealStage[]> {
  const { data, error } = await crmSupabase
    .from("crm_deal_stages")
    .select("id, workspace_id, name, sort_order, probability, is_closed_won, is_closed_lost, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmDealStageRow[]).map(toDealStage);
}

export async function listCrmOpenDealsForBoard(
  input: QrmDealBoardListInput = {}
): Promise<QrmPageResult<QrmRepSafeDeal>> {
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

  const rows = (data ?? []) as QrmRepSafeDealRow[];
  return {
    items: rows.slice(0, pageSize).map(toRepSafeDeal),
    nextCursor: rows.length > pageSize ? rows[pageSize].id : null,
  };
}

export async function getCrmDeal(dealId: string): Promise<QrmRepSafeDeal | null> {
  const { data, error } = await crmSupabase
    .from("crm_deals_rep_safe")
    .select(REP_SAFE_DEAL_SELECT)
    .eq("id", dealId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toRepSafeDeal(data as QrmRepSafeDealRow) : null;
}

export async function getCrmDealLossFields(dealId: string): Promise<QrmDealLossFields | null> {
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

  const row = data as Pick<QrmDealRow, "loss_reason" | "competitor">;
  return {
    lossReason: row.loss_reason,
    competitor: row.competitor,
  };
}

export async function listRepSafeDealsForContact(contactId: string): Promise<QrmRepSafeDeal[]> {
  const { data, error } = await crmSupabase
    .from("crm_deals_rep_safe")
    .select(REP_SAFE_DEAL_SELECT)
    .eq("primary_contact_id", contactId)
    .order("expected_close_on", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmRepSafeDealRow[]).map(toRepSafeDeal);
}

export async function listCrmWeightedOpenDeals(): Promise<QrmWeightedDeal[]> {
  const { data, error } = await crmSupabase
    .from("crm_deals_weighted")
    .select(WEIGHTED_DEAL_SELECT)
    .order("weighted_amount", { ascending: false, nullsFirst: false })
    .order("amount", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QrmWeightedDealRow[]).map(toWeightedDeal);
}

export async function patchCrmDeal(dealId: string, input: QrmDealPatchInput): Promise<QrmRepSafeDeal> {
  const payload: QrmDealPatchInput = {};
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

/**
 * Reorder deals within a pipeline stage. Calls the `crm_reorder_pipeline_deals`
 * RPC added in migration 254. The server enforces access + workspace + stage
 * membership for every deal id.
 *
 * The deals must already be in `stageId` at the time of the call — callers
 * that move a deal between stages should `patchCrmDeal({ stageId })` first,
 * then reorder within the new stage.
 */
export async function reorderPipelineDeals(stageId: string, orderedDealIds: string[]): Promise<void> {
  if (orderedDealIds.length === 0) return;

  const { error } = await crmSupabase.rpc("crm_reorder_pipeline_deals", {
    p_stage_id: stageId,
    p_ordered_deal_ids: orderedDealIds,
  });

  if (error) {
    throw new Error(error.message ?? "Reorder failed.");
  }
}
