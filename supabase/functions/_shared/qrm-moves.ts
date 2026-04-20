/**
 * Moves data access — the unit of work on the Today surface.
 *
 * Contract:
 *   listMoves(ctx, filters)  — GET /qrm/moves (rep sees their own, elevated sees all)
 *   patchMove(ctx, id, body) — PATCH /qrm/moves/:id (lifecycle: accept/snooze/dismiss/complete)
 *   createMove(ctx, body)    — POST /qrm/moves (service-role + elevated only; the
 *                              recommender is the normal caller)
 *
 * Status transitions:
 *   suggested  → accepted | snoozed | dismissed
 *   accepted   → completed | dismissed
 *   any        → expired (recommender only, time-based)
 */

import type { RouterCtx } from "./crm-router-service.ts";

export type MoveStatus =
  | "suggested"
  | "accepted"
  | "completed"
  | "snoozed"
  | "dismissed"
  | "expired";

export type MoveKind =
  | "call_now"
  | "send_quote"
  | "send_follow_up"
  | "schedule_meeting"
  | "escalate"
  | "drop_deal"
  | "reassign"
  | "field_visit"
  | "send_proposal"
  | "pricing_review"
  | "inventory_reserve"
  | "service_escalate"
  | "rescue_offer"
  | "other";

export type MoveEntityType =
  | "deal"
  | "contact"
  | "company"
  | "equipment"
  | "activity"
  | "rental"
  | "workspace";

export interface MoveRow {
  id: string;
  workspace_id: string;
  kind: MoveKind;
  status: MoveStatus;
  title: string;
  rationale: string | null;
  confidence: number | null;
  priority: number;
  entity_type: MoveEntityType | null;
  entity_id: string | null;
  assigned_rep_id: string | null;
  draft: Record<string, unknown> | null;
  signal_ids: string[];
  due_at: string | null;
  snoozed_until: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  recommender: string | null;
  recommender_version: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MoveListFilters {
  /** Filter by assigned rep. If omitted, rep callers default to their own uid. */
  assignedRepId: string | null;
  /** Filter by status. Defaults to ('suggested','accepted') on list view. */
  statuses: MoveStatus[];
  /** Filter by entity type. */
  entityType: MoveEntityType | null;
  /** Filter by entity id (pair with entityType for scoped views). */
  entityId: string | null;
  /** Page size. Defaults to 50, capped at 200. */
  limit: number;
}

const ACTIVE_STATUSES: MoveStatus[] = ["suggested", "accepted"];

const ALL_STATUSES: Set<MoveStatus> = new Set<MoveStatus>([
  "suggested",
  "accepted",
  "completed",
  "snoozed",
  "dismissed",
  "expired",
]);

const ALL_KINDS: Set<MoveKind> = new Set<MoveKind>([
  "call_now",
  "send_quote",
  "send_follow_up",
  "schedule_meeting",
  "escalate",
  "drop_deal",
  "reassign",
  "field_visit",
  "send_proposal",
  "pricing_review",
  "inventory_reserve",
  "service_escalate",
  "rescue_offer",
  "other",
]);

const ALL_ENTITY_TYPES: Set<MoveEntityType> = new Set<MoveEntityType>([
  "deal",
  "contact",
  "company",
  "equipment",
  "activity",
  "rental",
  "workspace",
]);

export function parseMoveListFilters(params: URLSearchParams): MoveListFilters {
  const statusParam = params.get("status");
  const statuses = statusParam
    ? statusParam
        .split(",")
        .map((raw) => raw.trim())
        .filter((raw): raw is MoveStatus => ALL_STATUSES.has(raw as MoveStatus))
    : ACTIVE_STATUSES;

  const entityTypeRaw = params.get("entity_type");
  const entityType =
    entityTypeRaw && ALL_ENTITY_TYPES.has(entityTypeRaw as MoveEntityType)
      ? (entityTypeRaw as MoveEntityType)
      : null;

  const entityId = params.get("entity_id");
  const assignedRepId = params.get("assigned_rep_id");

  const limitRaw = Number.parseInt(params.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  return {
    statuses: statuses.length > 0 ? statuses : ACTIVE_STATUSES,
    entityType,
    entityId: entityId && entityId.length > 0 ? entityId : null,
    assignedRepId: assignedRepId && assignedRepId.length > 0 ? assignedRepId : null,
    limit,
  };
}

export async function listMoves(
  ctx: RouterCtx,
  filters: MoveListFilters,
): Promise<MoveRow[]> {
  let query = ctx.callerDb
    .from("moves")
    .select("*")
    .eq("workspace_id", ctx.workspaceId);

  // For rep callers who didn't specify assigned_rep_id, scope to their own uid
  // so the default list is "my queue". Elevated callers see everything unless
  // they pass assigned_rep_id explicitly.
  if (filters.assignedRepId) {
    query = query.eq("assigned_rep_id", filters.assignedRepId);
  } else if (!ctx.caller.isServiceRole && ctx.caller.role === "rep" && ctx.caller.userId) {
    query = query.eq("assigned_rep_id", ctx.caller.userId);
  }

  query = query.in("status", filters.statuses);

  if (filters.entityType) {
    query = query.eq("entity_type", filters.entityType);
  }
  if (filters.entityId) {
    query = query.eq("entity_id", filters.entityId);
  }

  const { data, error } = await query
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit);

  if (error) throw error;
  return (data ?? []) as MoveRow[];
}

export interface MovePatchPayload {
  /**
   * Lifecycle action. Explicit over a free-form `status` so callers can't set
   * impossible transitions or back-date timestamps.
   */
  action: "accept" | "snooze" | "dismiss" | "complete" | "reopen";
  /** ISO timestamp for snooze. Required when action === "snooze". */
  snoozedUntil?: string;
  /** Optional human-readable reason, surfaced on dismiss/complete. */
  reason?: string;
}

export async function patchMove(
  ctx: RouterCtx,
  moveId: string,
  body: MovePatchPayload,
): Promise<MoveRow> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };

  switch (body.action) {
    case "accept":
      update.status = "accepted";
      update.accepted_at = now;
      break;
    case "snooze": {
      if (!body.snoozedUntil) {
        throw new Error("VALIDATION_ERROR:snoozedUntil_required");
      }
      const snoozed = new Date(body.snoozedUntil);
      if (Number.isNaN(snoozed.getTime()) || snoozed.getTime() <= Date.now()) {
        throw new Error("VALIDATION_ERROR:snoozedUntil_must_be_future");
      }
      update.status = "snoozed";
      update.snoozed_until = snoozed.toISOString();
      break;
    }
    case "dismiss":
      update.status = "dismissed";
      update.dismissed_at = now;
      if (body.reason) update.dismissed_reason = body.reason;
      break;
    case "complete":
      update.status = "completed";
      update.completed_at = now;
      break;
    case "reopen":
      // Reopen takes a snoozed/dismissed move back to suggested so reps can
      // re-evaluate a stale recommendation without the recommender re-firing.
      update.status = "suggested";
      update.dismissed_at = null;
      update.dismissed_reason = null;
      update.snoozed_until = null;
      break;
    default:
      throw new Error("VALIDATION_ERROR:unknown_action");
  }

  const { data, error } = await ctx.callerDb
    .from("moves")
    .update(update)
    .eq("id", moveId)
    .eq("workspace_id", ctx.workspaceId)
    .select("*")
    .single();

  if (error) throw error;
  return data as MoveRow;
}

export interface MoveCreatePayload {
  kind: MoveKind;
  title: string;
  rationale?: string | null;
  confidence?: number | null;
  priority?: number | null;
  entityType?: MoveEntityType | null;
  entityId?: string | null;
  assignedRepId?: string | null;
  draft?: Record<string, unknown> | null;
  signalIds?: string[];
  dueAt?: string | null;
  recommender?: string | null;
  recommenderVersion?: string | null;
  payload?: Record<string, unknown>;
}

export function validateMoveCreatePayload(body: MoveCreatePayload): void {
  if (!body.kind || !ALL_KINDS.has(body.kind)) {
    throw new Error("VALIDATION_ERROR:kind");
  }
  if (!body.title || typeof body.title !== "string" || body.title.length === 0) {
    throw new Error("VALIDATION_ERROR:title");
  }
  if (body.entityType && !ALL_ENTITY_TYPES.has(body.entityType)) {
    throw new Error("VALIDATION_ERROR:entityType");
  }
  if (body.priority != null && (body.priority < 0 || body.priority > 100)) {
    throw new Error("VALIDATION_ERROR:priority");
  }
  if (body.confidence != null && (body.confidence < 0 || body.confidence > 1)) {
    throw new Error("VALIDATION_ERROR:confidence");
  }
}

export async function createMove(ctx: RouterCtx, body: MoveCreatePayload): Promise<MoveRow> {
  validateMoveCreatePayload(body);

  const row = {
    workspace_id: ctx.workspaceId,
    kind: body.kind,
    title: body.title,
    rationale: body.rationale ?? null,
    confidence: body.confidence ?? null,
    priority: body.priority ?? 50,
    entity_type: body.entityType ?? null,
    entity_id: body.entityId ?? null,
    assigned_rep_id: body.assignedRepId ?? null,
    draft: body.draft ?? null,
    signal_ids: body.signalIds ?? [],
    due_at: body.dueAt ?? null,
    recommender: body.recommender ?? null,
    recommender_version: body.recommenderVersion ?? null,
    payload: body.payload ?? {},
  };

  const { data, error } = await ctx.admin
    .from("moves")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return data as MoveRow;
}
