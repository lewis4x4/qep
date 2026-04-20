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

/** Touch channel enum — mirrors the public.operator_touch_channel DB enum. */
export type TouchChannel =
  | "call"
  | "email"
  | "meeting"
  | "sms"
  | "field_visit"
  | "voice_note"
  | "chat"
  | "other";

const TOUCH_CHANNELS: Set<TouchChannel> = new Set<TouchChannel>([
  "call",
  "email",
  "meeting",
  "sms",
  "field_visit",
  "voice_note",
  "chat",
  "other",
]);

/**
 * Optional touch payload attached to a move-complete action.
 *
 * When a rep finishes a move ("Done"), they can log what they actually did
 * (called, emailed, visited) and the backend auto-creates a `touches` row
 * linked back to the move via `from_move_id`. The deal health score reads
 * from touches, so this is what makes completed moves "count" for scoring.
 *
 * If the rep skips the composer and just taps Done, the router still creates
 * a minimal touch (channel: "other", summary derived from the move title)
 * so the graph always records that work happened — that way an operator
 * can't silently complete 50 moves without any visible touches.
 */
export interface MoveCompleteTouch {
  channel: TouchChannel;
  summary?: string;
  body?: string;
  durationSeconds?: number;
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
  /**
   * Optional touch payload for `complete`. When provided, the router creates
   * a `touches` row and suppresses the signals that triggered the move for
   * a 7-day cool-off window. Ignored for non-complete actions.
   */
  touch?: MoveCompleteTouch;
}

/** Default cool-off for suppressed signals after a move completes. */
const SIGNAL_SUPPRESS_DAYS = 7;

function validateTouchPayload(touch: MoveCompleteTouch): void {
  if (!TOUCH_CHANNELS.has(touch.channel)) {
    throw new Error("VALIDATION_ERROR:touch_channel");
  }
  if (touch.summary != null && typeof touch.summary !== "string") {
    throw new Error("VALIDATION_ERROR:touch_summary");
  }
  if (touch.body != null && typeof touch.body !== "string") {
    throw new Error("VALIDATION_ERROR:touch_body");
  }
  if (
    touch.durationSeconds != null &&
    (!Number.isFinite(touch.durationSeconds) || touch.durationSeconds < 0)
  ) {
    throw new Error("VALIDATION_ERROR:touch_duration");
  }
}

/**
 * Insert a touch tied to a just-completed move and suppress the signals
 * that triggered it.
 *
 * Runs on the admin client because:
 *   - touch insert needs to stamp actor_user_id = the caller (RLS on touches
 *     requires the actor to be the caller, which we already guarantee), but
 *     cross-entity FK checks (contact/company/deal/equipment) are simpler
 *     on the service-role client, and
 *   - signal suppression must succeed even if the rep doesn't directly
 *     "own" a signal row per RLS (e.g. a workspace-scoped SLA signal).
 *
 * Returns the touch id on success. Failures here do NOT roll back the
 * move status — the move is considered completed regardless so the rep's
 * action isn't lost; the caller logs the error and moves on. The touch
 * can be re-logged manually if ingest misfires.
 */
async function recordMoveCompletionSideEffects(
  ctx: RouterCtx,
  move: MoveRow,
  touch: MoveCompleteTouch | undefined,
): Promise<{ touchId: string | null; signalsSuppressed: number }> {
  // Build the touch row. If the rep didn't supply a payload, we still log
  // a minimal "other" touch so the graph reflects that work happened.
  const channel: TouchChannel = touch?.channel ?? "other";
  const summary = touch?.summary ?? move.title;
  const body = touch?.body ?? null;
  const duration = touch?.durationSeconds ?? null;

  const touchInsert: Record<string, unknown> = {
    workspace_id: ctx.workspaceId,
    channel,
    direction: "outbound", // Moves are always rep-initiated → outbound.
    summary,
    body,
    duration_seconds: duration,
    actor_user_id: ctx.caller.userId,
    from_move_id: move.id,
    occurred_at: new Date().toISOString(),
    metadata: { source: "move_complete", move_kind: move.kind },
  };

  // Wire the touch to whichever entity the move targeted. The touches table
  // requires at least one of (contact, company, deal, equipment) to be set;
  // activity-, rental-, workspace-typed moves don't map to any of those
  // columns cleanly, so we skip touch creation entirely for those and only
  // do signal suppression.
  let entityAssigned = false;
  switch (move.entity_type) {
    case "contact":
      touchInsert.contact_id = move.entity_id;
      entityAssigned = true;
      break;
    case "company":
      touchInsert.company_id = move.entity_id;
      entityAssigned = true;
      break;
    case "deal":
      touchInsert.deal_id = move.entity_id;
      entityAssigned = true;
      break;
    case "equipment":
      touchInsert.equipment_id = move.entity_id;
      entityAssigned = true;
      break;
  }

  let touchId: string | null = null;
  if (entityAssigned) {
    const { data: inserted, error: insertErr } = await ctx.admin
      .from("touches")
      .insert(touchInsert)
      .select("id")
      .single();
    if (insertErr) {
      // Surface the error but don't block the move status update: the caller
      // catches this and logs so observability is preserved.
      throw new Error(`TOUCH_INSERT_FAILED:${insertErr.message}`);
    }
    touchId = (inserted as { id: string } | null)?.id ?? null;
  }

  // Suppress the signals that triggered this move so they don't re-fire
  // on the next recommender sweep. Scoped to workspace so we never reach
  // across tenants even if a stale signal id got wedged into the move.
  let suppressed = 0;
  if (move.signal_ids && move.signal_ids.length > 0) {
    const suppressedUntil = new Date(
      Date.now() + SIGNAL_SUPPRESS_DAYS * 86_400_000,
    ).toISOString();
    const { error: suppressErr, count } = await ctx.admin
      .from("signals")
      .update({ suppressed_until: suppressedUntil }, { count: "exact" })
      .eq("workspace_id", ctx.workspaceId)
      .in("id", move.signal_ids);
    if (suppressErr) {
      throw new Error(`SIGNAL_SUPPRESS_FAILED:${suppressErr.message}`);
    }
    suppressed = count ?? 0;
  }

  return { touchId, signalsSuppressed: suppressed };
}

/** Shape returned by patchMove — may include touch/suppression summary. */
export interface MovePatchResult {
  move: MoveRow;
  touchId: string | null;
  signalsSuppressed: number;
}

export async function patchMove(
  ctx: RouterCtx,
  moveId: string,
  body: MovePatchPayload,
): Promise<MovePatchResult> {
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
      if (body.touch) validateTouchPayload(body.touch);
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

  // Double-completion guard: when action=complete, gate the UPDATE on
  // `completed_at is null`. A stale client retrying after a successful
  // complete will get back 0 rows (no data, PGRST116 error), at which
  // point we fetch the move verbatim and return it without re-firing the
  // side effects. This keeps touch insertions exactly-once-per-completion
  // without needing a transaction / stored procedure.
  let mutation = ctx.callerDb
    .from("moves")
    .update(update)
    .eq("id", moveId)
    .eq("workspace_id", ctx.workspaceId);
  if (body.action === "complete") {
    mutation = mutation.is("completed_at", null);
  }
  const { data, error } = await mutation.select("*").single();

  if (error) {
    // PGRST116 = "The result contains 0 rows", the specific code PostgREST
    // returns when a .single() query matches nothing. We only hit that on
    // the complete-path because of the is("completed_at", null) filter;
    // treat it as "already completed" and fall through to a re-fetch.
    const alreadyCompleted =
      body.action === "complete" && (error as { code?: string }).code === "PGRST116";
    if (!alreadyCompleted) throw error;

    const { data: existing, error: fetchError } = await ctx.callerDb
      .from("moves")
      .select("*")
      .eq("id", moveId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) throw new Error("move_not_found");
    return { move: existing as MoveRow, touchId: null, signalsSuppressed: 0 };
  }

  const move = data as MoveRow;

  if (body.action === "complete") {
    const sideEffects = await recordMoveCompletionSideEffects(
      ctx,
      move,
      body.touch,
    );
    return {
      move,
      touchId: sideEffects.touchId,
      signalsSuppressed: sideEffects.signalsSuppressed,
    };
  }

  return { move, touchId: null, signalsSuppressed: 0 };
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
