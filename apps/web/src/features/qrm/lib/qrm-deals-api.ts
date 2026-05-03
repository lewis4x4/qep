import { crmSupabase } from "./qrm-supabase";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function normalizeRepSafeDealRows(rows: unknown): QrmRepSafeDeal[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((r) => {
    if (!isRecord(r) || typeof r.id !== "string") return [];

    return [{
      id: r.id,
      workspaceId: requiredString(r.workspace_id, "default"),
      name: requiredString(r.name, "Untitled deal"),
      stageId: requiredString(r.stage_id, ""),
      primaryContactId: nullableString(r.primary_contact_id),
      companyId: nullableString(r.company_id),
      assignedRepId: nullableString(r.assigned_rep_id),
      amount: nullableNumber(r.amount),
      expectedCloseOn: nullableString(r.expected_close_on),
      nextFollowUpAt: nullableString(r.next_follow_up_at),
      lastActivityAt: nullableString(r.last_activity_at),
      closedAt: nullableString(r.closed_at),
      hubspotDealId: nullableString(r.hubspot_deal_id),
      createdAt: requiredString(r.created_at, ""),
      updatedAt: requiredString(r.updated_at, ""),
      slaDeadlineAt: nullableString(r.sla_deadline_at),
      depositStatus: nullableString(r.deposit_status),
      depositAmount: nullableNumber(r.deposit_amount),
      sortPosition: nullableNumber(r.sort_position),
      marginPct: nullableNumber(r.margin_pct),
    }];
  });
}

export function normalizeWeightedDealRows(rows: unknown): QrmWeightedDeal[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      workspaceId: requiredString(row.workspace_id, "default"),
      name: requiredString(row.name, "Untitled deal"),
      stageId: requiredString(row.stage_id, ""),
      stageName: requiredString(row.stage_name, "Unknown"),
      stageProbability: nullableNumber(row.stage_probability),
      primaryContactId: nullableString(row.primary_contact_id),
      companyId: nullableString(row.company_id),
      assignedRepId: nullableString(row.assigned_rep_id),
      amount: nullableNumber(row.amount),
      weightedAmount: nullableNumber(row.weighted_amount),
      expectedCloseOn: nullableString(row.expected_close_on),
      nextFollowUpAt: nullableString(row.next_follow_up_at),
      lastActivityAt: nullableString(row.last_activity_at),
      closedAt: nullableString(row.closed_at),
      hubspotDealId: nullableString(row.hubspot_deal_id),
      createdAt: requiredString(row.created_at, ""),
      updatedAt: requiredString(row.updated_at, ""),
    }];
  });
}

export function normalizeDealStageRows(rows: unknown): QrmDealStage[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      workspaceId: requiredString(row.workspace_id, "default"),
      name: requiredString(row.name, "Unnamed stage"),
      sortOrder: nullableNumber(row.sort_order) ?? 0,
      probability: nullableNumber(row.probability),
      isClosedWon: nullableBoolean(row.is_closed_won) ?? false,
      isClosedLost: nullableBoolean(row.is_closed_lost) ?? false,
      createdAt: requiredString(row.created_at, ""),
      updatedAt: requiredString(row.updated_at, ""),
    }];
  });
}

function toRepSafeDeal(row: QrmRepSafeDeal): QrmRepSafeDeal {
  return {
    ...row,
  };
}

function toWeightedDeal(row: QrmWeightedDeal): QrmWeightedDeal {
  return {
    ...row,
  };
}

function toDealStage(row: QrmDealStage): QrmDealStage {
  return {
    ...row,
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

  return normalizeDealStageRows(data).map(toDealStage);
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

  const rows = normalizeRepSafeDealRows(data);
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

  return normalizeRepSafeDealRows(data ? [data] : [])[0] ?? null;
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

  return {
    lossReason: isRecord(data) ? nullableString(data.loss_reason) : null,
    competitor: isRecord(data) ? nullableString(data.competitor) : null,
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

  return normalizeRepSafeDealRows(data).map(toRepSafeDeal);
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

  return normalizeWeightedDealRows(data).map(toWeightedDeal);
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
