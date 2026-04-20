/**
 * Ask Iron — tool-use catalog + executor for the QRM assistant.
 *
 * Slice 4 of the 4-surface collapse. "Ask Iron" is the ambient agent surface:
 * reps ask "what's on my plate?", "which rentals are returning next week?",
 * "pull up Acme" — and the agent answers with real rows, not hallucinated
 * prose. This module owns the tool catalog and the executor; the edge
 * function is a thin Claude tool-use loop around it.
 *
 * Why a separate module:
 *   1. Testable without the Anthropic API or real HTTP — stubbed
 *      SupabaseClient → assert tool routing and workspace scoping.
 *   2. Sharable with future clients (CarPlay/watch bridges, terminal
 *      debugger, etc.) that want the same tool contract.
 *
 * Tool catalog:
 *   - list_my_moves        — today's moves for the caller (rep → own; elevated → all)
 *   - list_recent_signals  — recent signal stream, with severity/kind filters
 *   - search_entities      — fuzzy search across contacts/companies/deals
 *   - get_deal_detail      — drill into a single deal (id known)
 *   - get_company_detail   — drill into a single company (id known)
 *   - propose_move         — create a new move in Today (Slice 6: write surface)
 *
 * Auth envelope:
 *   Tools run through the same `RouterCtx` as the HTTP router, so RLS on
 *   `callerDb` enforces workspace+rep visibility and admin tables like
 *   `moves` fall back to the service-role admin client for signal triage.
 *   The caller's role never widens inside the executor.
 *
 * Cost guardrails:
 *   - Row caps on every list tool (25 default, 50 hard max).
 *   - Text returned to Claude capped per-tool to keep context small.
 *   - No embeddings / RAG call in the hot path (Slice 5 territory).
 */

import type { RouterCtx } from "./crm-router-service.ts";
import {
  createMove,
  type MoveCreatePayload,
  type MoveEntityType,
  type MoveKind,
} from "./qrm-moves.ts";

// ── Tool schema ────────────────────────────────────────────────────────────

export interface AskIronTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool definitions surfaced to Claude. Keep these descriptions concrete —
 * the LLM picks from them, so vague copy → wrong tool choice.
 */
export const ASK_IRON_TOOLS: AskIronTool[] = [
  {
    name: "list_my_moves",
    description:
      "Recommended moves from the QRM recommender. Rep callers see their own queue; admins/managers see everyone's unless they pass assigned_rep_id. Use for 'what should I do next', 'what's on my plate', 'any hot moves today'.",
    input_schema: {
      type: "object",
      properties: {
        statuses: {
          type: "array",
          items: {
            type: "string",
            enum: ["suggested", "accepted", "completed", "snoozed", "dismissed"],
          },
          description:
            "Default ['suggested','accepted']. Pass ['completed'] for a recap of what's been cleared today.",
        },
        assigned_rep_id: {
          type: "string",
          description:
            "UUID of a rep. Admins/managers use this to answer 'what's on Jim's plate'. Reps can only use their own.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "list_recent_signals",
    description:
      "The normalized event stream — inbound emails, telematics faults, SLA breaches, news mentions, quote-viewed, etc. Use for 'what changed', 'any new faults', 'anyone in the news this week'.",
    input_schema: {
      type: "object",
      properties: {
        kinds: {
          type: "array",
          items: { type: "string" },
          description:
            "Signal kinds to include, e.g. ['inbound_email','telematics_fault']. Omit for all.",
        },
        severity_at_least: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Floor severity; returns this severity and above.",
        },
        since_hours: {
          type: "integer",
          minimum: 1,
          maximum: 168,
          description: "Only signals within the last N hours. Default 48.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "search_entities",
    description:
      "Fuzzy search across contacts, companies, deals, equipment, rentals in the caller's workspace. Use whenever the question names a customer, rep, job, or machine by partial name.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The term to search for." },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["company", "contact", "deal", "equipment", "rental"],
          },
          description: "Entity types to include. Omit for all.",
        },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_deal_detail",
    description:
      "Full detail for a specific deal by id (from list_my_moves or search_entities). Returns amount, stage, expected close, assigned rep.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string" },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "get_company_detail",
    description:
      "Full detail for a specific company by id. Returns name, city/state, industry, open deal count.",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "propose_move",
    description:
      "Create a new move on the operator's Today queue. Use when the operator explicitly asks for a follow-up action ('add a call to Acme tomorrow', 'remind me to send a quote', 'queue a field visit on Wednesday'). Do NOT use proactively — propose only when the operator requested an action. The move is assigned to the caller by default; managers/admins may route to another rep in the same workspace.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [
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
          ],
          description:
            "Move kind — pick the one closest to the action the operator asked for. Use 'other' only if nothing else fits.",
        },
        title: {
          type: "string",
          description:
            "Short imperative summary of the action, e.g. 'Call Acme about CAT 305 quote'. Max 120 chars.",
        },
        rationale: {
          type: "string",
          description:
            "One-sentence reason, grounded in the operator's request. Max 280 chars.",
        },
        entity_type: {
          type: "string",
          enum: ["deal", "contact", "company", "equipment", "rental"],
          description:
            "What the move is about. Omit only if the move doesn't map to a specific entity.",
        },
        entity_id: {
          type: "string",
          description:
            "UUID for the entity, obtained from search_entities / list_my_moves / list_recent_signals.",
        },
        priority: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description:
            "Priority 0–100. Default 55 for operator-requested moves (slightly above baseline).",
        },
        due_at: {
          type: "string",
          description:
            "ISO-8601 timestamp for when this should be done by. Omit if the operator didn't give one.",
        },
        assigned_rep_id: {
          type: "string",
          description:
            "UUID of the rep to own this move. Elevated callers only; rep callers are always assigned their own id regardless of this field.",
        },
      },
      required: ["kind", "title"],
    },
  },
];

// ── Input normalization (pure, testable) ────────────────────────────────────

export interface NormalizedMoveFilters {
  statuses: Array<
    "suggested" | "accepted" | "completed" | "snoozed" | "dismissed"
  >;
  assignedRepId: string | null;
  limit: number;
}

const ALLOWED_MOVE_STATUSES = new Set<NormalizedMoveFilters["statuses"][number]>([
  "suggested",
  "accepted",
  "completed",
  "snoozed",
  "dismissed",
]);

/**
 * Normalize LLM-provided input for `list_my_moves`. We validate here (not
 * inside the Supabase call) so a hallucinated status string becomes a clean
 * fallback instead of a query error.
 *
 * Rep enforcement: if the caller is a rep, `assigned_rep_id` gets pinned to
 * the caller's own userId regardless of what the model passed. This is the
 * single checkpoint that keeps the agent from leaking another rep's queue.
 */
export function normalizeMoveFilters(
  input: Record<string, unknown>,
  ctx: RouterCtx,
): NormalizedMoveFilters {
  const rawStatuses = Array.isArray(input.statuses) ? input.statuses : null;
  const statuses = rawStatuses
    ? (rawStatuses
        .filter((s): s is string => typeof s === "string")
        .filter((s) =>
          ALLOWED_MOVE_STATUSES.has(s as NormalizedMoveFilters["statuses"][number]),
        ) as NormalizedMoveFilters["statuses"])
    : (["suggested", "accepted"] as NormalizedMoveFilters["statuses"]);

  const requestedRepId =
    typeof input.assigned_rep_id === "string" && input.assigned_rep_id.length > 0
      ? input.assigned_rep_id
      : null;

  // Rep callers: pin to self. Service/elevated: honor requested, else null.
  let assignedRepId: string | null;
  if (!ctx.caller.isServiceRole && ctx.caller.role === "rep") {
    assignedRepId = ctx.caller.userId;
  } else {
    assignedRepId = requestedRepId;
  }

  const limitRaw = Number(input.limit ?? 15);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
    : 15;

  return {
    statuses: statuses.length > 0 ? statuses : ["suggested", "accepted"],
    assignedRepId,
    limit,
  };
}

export interface NormalizedSignalFilters {
  kinds: string[];
  severityAtLeast: "low" | "medium" | "high" | "critical" | null;
  sinceIso: string;
  limit: number;
}

const ALLOWED_SEVERITIES = new Set<
  NonNullable<NormalizedSignalFilters["severityAtLeast"]>
>(["low", "medium", "high", "critical"]);

export function normalizeSignalFilters(
  input: Record<string, unknown>,
  nowMs: number = Date.now(),
): NormalizedSignalFilters {
  const rawKinds = Array.isArray(input.kinds) ? input.kinds : null;
  const kinds = rawKinds
    ? rawKinds.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];

  const sevRaw = typeof input.severity_at_least === "string"
    ? input.severity_at_least
    : null;
  const severityAtLeast = sevRaw && ALLOWED_SEVERITIES.has(
    sevRaw as NonNullable<NormalizedSignalFilters["severityAtLeast"]>,
  )
    ? (sevRaw as NonNullable<NormalizedSignalFilters["severityAtLeast"]>)
    : null;

  const hoursRaw = Number(input.since_hours ?? 48);
  const hours = Number.isFinite(hoursRaw)
    ? Math.min(Math.max(Math.trunc(hoursRaw), 1), 168)
    : 48;
  const sinceIso = new Date(nowMs - hours * 3_600_000).toISOString();

  const limitRaw = Number(input.limit ?? 20);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50)
    : 20;

  return { kinds, severityAtLeast, sinceIso, limit };
}

export interface NormalizedSearchInput {
  query: string;
  types: string[];
  limit: number;
}

const ALLOWED_SEARCH_TYPES = new Set<string>([
  "company",
  "contact",
  "deal",
  "equipment",
  "rental",
]);

/**
 * Strip PostgREST meta-characters from the free-text query before it gets
 * interpolated into an `.or()` or `.ilike()` filter.
 *
 * Why this matters: PostgREST parses `.or("first_name.ilike.${x}")` with `,`
 * as the expression separator, so a raw user string like
 *   `foo,id.neq.00000000-0000-0000-0000-000000000000`
 * would escape the ilike operand and inject a free filter. We also drop
 * `%` and `_` (ilike wildcards the caller didn't write) and `.` (PostgREST
 * op separator) and backslashes. The pattern mirrors `cleanSearchTerm` in
 * _shared/crm-router-service.ts but is stricter — we can afford to be
 * strict because the LLM is the only caller producing these inputs, and it
 * should not rely on wildcard injection for matches.
 */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[,%_()\\.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSearchInput(
  input: Record<string, unknown>,
): NormalizedSearchInput {
  const query = typeof input.query === "string"
    ? sanitizeSearchTerm(input.query)
    : "";
  const rawTypes = Array.isArray(input.types) ? input.types : [];
  const types = rawTypes
    .filter((t): t is string => typeof t === "string")
    .filter((t) => ALLOWED_SEARCH_TYPES.has(t));
  const limitRaw = Number(input.limit ?? 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 25)
    : 10;
  return { query, types, limit };
}

// ── propose_move normalization ─────────────────────────────────────────────

export interface NormalizedProposeMove {
  kind: MoveKind;
  title: string;
  rationale: string | null;
  entityType: MoveEntityType | null;
  entityId: string | null;
  priority: number;
  dueAt: string | null;
  assignedRepId: string | null;
}

const ALLOWED_MOVE_KINDS = new Set<MoveKind>([
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

// Iron is not allowed to propose moves on "activity" or "workspace" entities —
// those are internal scopes the recommender uses, not operator-facing targets.
const ALLOWED_PROPOSE_ENTITY_TYPES = new Set<MoveEntityType>([
  "deal",
  "contact",
  "company",
  "equipment",
  "rental",
]);

const MAX_PROPOSE_TITLE_CHARS = 120;
const MAX_PROPOSE_RATIONALE_CHARS = 280;

function clampText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + "…";
}

/**
 * Validate + normalize the LLM-supplied `propose_move` input before it hits
 * the DB. Throws on structural problems (unknown kind, missing title) so the
 * caller can return a clean tool error and Claude can retry. Rep callers
 * always get `assigned_rep_id` pinned to their own userId — the same checkpoint
 * used by `normalizeMoveFilters`.
 */
export function normalizeProposeMoveInput(
  input: Record<string, unknown>,
  ctx: RouterCtx,
): NormalizedProposeMove {
  const kindRaw = typeof input.kind === "string" ? input.kind : "";
  if (!ALLOWED_MOVE_KINDS.has(kindRaw as MoveKind)) {
    throw new Error("VALIDATION_ERROR:kind");
  }
  const kind = kindRaw as MoveKind;

  const title = clampText(input.title, MAX_PROPOSE_TITLE_CHARS);
  if (!title) throw new Error("VALIDATION_ERROR:title");

  const rationale = clampText(input.rationale, MAX_PROPOSE_RATIONALE_CHARS);

  // Entity scope: if `entity_type` is provided it must be in the allowed set,
  // and `entity_id` must accompany it. We reject mismatches rather than
  // silently stripping — a half-scoped move is worse than an error because
  // the operator sees "call about Acme" with no contact attached.
  let entityType: MoveEntityType | null = null;
  let entityId: string | null = null;
  if (typeof input.entity_type === "string" && input.entity_type.length > 0) {
    if (!ALLOWED_PROPOSE_ENTITY_TYPES.has(input.entity_type as MoveEntityType)) {
      throw new Error("VALIDATION_ERROR:entity_type");
    }
    entityType = input.entity_type as MoveEntityType;
    if (typeof input.entity_id !== "string" || input.entity_id.length === 0) {
      throw new Error("VALIDATION_ERROR:entity_id");
    }
    entityId = input.entity_id;
  } else if (
    typeof input.entity_id === "string" && input.entity_id.length > 0
  ) {
    // entity_id without entity_type is ambiguous — reject rather than guess.
    throw new Error("VALIDATION_ERROR:entity_type");
  }

  // Priority: clamp 0..100, default 55 (a hair above baseline 50) to reflect
  // "operator asked for this" weighting without drowning the recommender queue.
  const priorityRaw = Number(input.priority ?? 55);
  const priority = Number.isFinite(priorityRaw)
    ? Math.min(Math.max(Math.trunc(priorityRaw), 0), 100)
    : 55;

  // due_at: accept if the string parses as a Date and isn't in the past by
  // more than a minute (small clock-skew tolerance). Reject nonsense quietly
  // by throwing — better than inserting a bogus timestamp.
  let dueAt: string | null = null;
  if (typeof input.due_at === "string" && input.due_at.length > 0) {
    const parsed = new Date(input.due_at);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("VALIDATION_ERROR:due_at");
    }
    if (parsed.getTime() < Date.now() - 60_000) {
      throw new Error("VALIDATION_ERROR:due_at");
    }
    dueAt = parsed.toISOString();
  }

  // Rep assignment: reps are always pinned to self; elevated callers may
  // route to another rep id (workspace-membership is validated at insert
  // time by the DB's RLS/FK, but we could harden here with a profiles lookup
  // if abuse shows up).
  const requestedRepId = typeof input.assigned_rep_id === "string" &&
      input.assigned_rep_id.length > 0
    ? input.assigned_rep_id
    : null;
  let assignedRepId: string | null;
  if (!ctx.caller.isServiceRole && ctx.caller.role === "rep") {
    assignedRepId = ctx.caller.userId;
  } else {
    assignedRepId = requestedRepId ?? ctx.caller.userId;
  }

  return { kind, title, rationale, entityType, entityId, priority, dueAt, assignedRepId };
}

// ── Executor ────────────────────────────────────────────────────────────────

/**
 * Per-request mutable budget carried through `executeAskIronTool`. A single
 * Ask Iron HTTP request may fan out multiple tool calls across several Claude
 * turns — this counter keeps the model from stuffing Today with 10 moves in
 * one run. The edge function owns the lifecycle (one fresh session per POST);
 * unit tests can construct their own to exercise the cap directly.
 */
export interface AskIronSession {
  proposedMoveCount: number;
}

export function createAskIronSession(): AskIronSession {
  return { proposedMoveCount: 0 };
}

export const MAX_PROPOSE_MOVES_PER_REQUEST = 3;

export interface AskIronToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a single tool call. Returns a serialized-friendly payload that the
 * caller hands back to Claude as a `tool_result`.
 *
 * Hard contract: every row leaving this function is RLS-filtered through
 * `ctx.callerDb`. The one exception is `list_my_moves`, which reads from the
 * `moves` table (no RLS for callerDb yet — moves are admin-managed) and
 * applies explicit workspace+rep filters before returning.
 */
export async function executeAskIronTool(
  ctx: RouterCtx,
  name: string,
  input: Record<string, unknown>,
  session?: AskIronSession,
): Promise<AskIronToolResult> {
  try {
    switch (name) {
      case "list_my_moves":
        return { ok: true, data: await toolListMyMoves(ctx, input) };
      case "list_recent_signals":
        return { ok: true, data: await toolListRecentSignals(ctx, input) };
      case "search_entities":
        return { ok: true, data: await toolSearchEntities(ctx, input) };
      case "get_deal_detail":
        return { ok: true, data: await toolGetDealDetail(ctx, input) };
      case "get_company_detail":
        return { ok: true, data: await toolGetCompanyDetail(ctx, input) };
      case "propose_move": {
        // Per-request cap. We return a structured error (not throw) so Claude
        // sees it in the tool result and can apologize to the operator
        // without retrying — throwing would surface as a generic `tool failed`.
        if (
          session &&
          session.proposedMoveCount >= MAX_PROPOSE_MOVES_PER_REQUEST
        ) {
          return {
            ok: false,
            error:
              `propose_move budget exhausted (max ${MAX_PROPOSE_MOVES_PER_REQUEST} per request). Tell the operator to queue additional moves directly on Today.`,
          };
        }
        const data = await toolProposeMove(ctx, input);
        if (session) session.proposedMoveCount += 1;
        return { ok: true, data };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function toolListMyMoves(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const f = normalizeMoveFilters(input, ctx);
  // Moves live in the `moves` table. We filter via the admin client here
  // because the rep-scoping is enforced in this module (see
  // normalizeMoveFilters) — callerDb would also work once RLS lands, but
  // the explicit filter pattern makes the scoping rule auditable.

  // Defence-in-depth: if an elevated caller passed an `assigned_rep_id`
  // from LLM input, confirm that rep belongs to the caller's workspace
  // before we pull their queue. This is a cheap guard against prompt-
  // injected cross-tenant peeks. Reps are already pinned to their own id
  // upstream in normalizeMoveFilters, so this only matters for
  // admin/manager/owner callers.
  if (
    f.assignedRepId &&
    !ctx.caller.isServiceRole &&
    ctx.caller.role !== "rep" &&
    f.assignedRepId !== ctx.caller.userId
  ) {
    const { data: repRow } = await ctx.admin
      .from("profiles")
      .select("id, workspace_id")
      .eq("id", f.assignedRepId)
      .maybeSingle();
    const repWorkspace = (repRow as { workspace_id?: string } | null)
      ?.workspace_id;
    // profiles may not be workspace-scoped in the current schema; when the
    // column is absent we fall through. Once profiles carry workspace_id
    // this becomes a hard gate.
    if (repWorkspace && repWorkspace !== ctx.workspaceId) {
      throw new Error("rep not in workspace");
    }
  }

  let q = ctx.admin
    .from("moves")
    .select(
      "id, kind, status, title, rationale, confidence, priority, entity_type, entity_id, assigned_rep_id, due_at, created_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .in("status", f.statuses);

  if (f.assignedRepId) {
    q = q.eq("assigned_rep_id", f.assignedRepId);
  }

  const { data, error } = await q
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(f.limit);

  if (error) throw error;
  return {
    moves: (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: row.title,
      rationale: row.rationale,
      priority: row.priority,
      entity: row.entity_type && row.entity_id
        ? { type: row.entity_type, id: row.entity_id }
        : null,
      assigned_rep_id: row.assigned_rep_id,
      due_at: row.due_at,
    })),
  };
}

async function toolListRecentSignals(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const f = normalizeSignalFilters(input);

  let q = ctx.callerDb
    .from("signals")
    .select(
      "id, kind, severity, source, title, description, entity_type, entity_id, occurred_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .gte("occurred_at", f.sinceIso);

  if (f.kinds.length > 0) q = q.in("kind", f.kinds);
  if (f.severityAtLeast) {
    const order = { low: 0, medium: 1, high: 2, critical: 3 } as const;
    const floor = order[f.severityAtLeast];
    const allowed = (Object.entries(order) as Array<[keyof typeof order, number]>)
      .filter(([, idx]) => idx >= floor)
      .map(([k]) => k);
    q = q.in("severity", allowed);
  }

  const { data, error } = await q
    .order("occurred_at", { ascending: false })
    .limit(f.limit);

  if (error) throw error;
  return { signals: data ?? [] };
}

async function toolSearchEntities(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const f = normalizeSearchInput(input);
  if (!f.query) throw new Error("query required");
  const like = `%${f.query}%`;
  const types = f.types.length > 0 ? new Set(f.types) : null;

  const results: Array<{
    type: string;
    id: string;
    title: string;
    subtitle: string | null;
  }> = [];

  if (!types || types.has("company")) {
    const { data, error } = await ctx.callerDb
      .from("crm_companies")
      .select("id, name, city, state")
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .ilike("name", like)
      .limit(f.limit);
    if (error) throw error;
    for (const row of data ?? []) {
      const loc = [row.city, row.state].filter(Boolean).join(", ");
      results.push({
        type: "company",
        id: String(row.id),
        title: String(row.name ?? "Untitled company"),
        subtitle: loc || null,
      });
    }
  }

  if (!types || types.has("contact")) {
    const { data, error } = await ctx.callerDb
      .from("crm_contacts")
      .select("id, first_name, last_name, email, phone")
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .or(
        `first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`,
      )
      .limit(f.limit);
    if (error) throw error;
    for (const row of data ?? []) {
      const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      results.push({
        type: "contact",
        id: String(row.id),
        title: name || "Unnamed contact",
        subtitle: (row.email || row.phone || null) as string | null,
      });
    }
  }

  if (!types || types.has("deal")) {
    const { data, error } = await ctx.callerDb
      .from("crm_deals_rep_safe")
      .select("id, name, amount, expected_close_on")
      .eq("workspace_id", ctx.workspaceId)
      .ilike("name", like)
      .limit(f.limit);
    if (error) throw error;
    for (const row of data ?? []) {
      const amt = row.amount != null && Number.isFinite(Number(row.amount))
        ? `$${Number(row.amount).toLocaleString()}`
        : null;
      const close = row.expected_close_on
        ? `close ${String(row.expected_close_on)}`
        : null;
      results.push({
        type: "deal",
        id: String(row.id),
        title: String(row.name ?? "Untitled deal"),
        subtitle: [amt, close].filter(Boolean).join(" · ") || null,
      });
    }
  }

  return { matches: results.slice(0, f.limit) };
}

async function toolGetDealDetail(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const dealId = typeof input.deal_id === "string" ? input.deal_id : "";
  if (!dealId) throw new Error("deal_id required");
  const { data, error } = await ctx.callerDb
    .from("crm_deals_rep_safe")
    .select(
      "id, name, amount, expected_close_on, assigned_rep_id, updated_at, company_id",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", dealId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { found: false };
  return { found: true, deal: data };
}

async function toolGetCompanyDetail(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const companyId = typeof input.company_id === "string" ? input.company_id : "";
  if (!companyId) throw new Error("company_id required");
  const { data, error } = await ctx.callerDb
    .from("crm_companies")
    .select("id, name, city, state, country, industry, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { found: false };
  return { found: true, company: data };
}

/**
 * Create a move on behalf of the operator via the normal createMove path.
 * Provenance is stamped so the Today surface can badge this as "proposed by
 * Iron" (and a future recommender can weight or deduplicate against these).
 */
async function toolProposeMove(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const n = normalizeProposeMoveInput(input, ctx);

  // Cross-tenant write guard. If an elevated caller routed this move to a
  // rep other than themselves, confirm that rep lives in the caller's
  // workspace before the insert. Reps are already pinned to `userId` in
  // normalizeProposeMoveInput, so this branch is admin/manager/owner only.
  // Mirrors the same defense in toolListMyMoves — more important here
  // because propose_move writes, whereas list_my_moves only reads.
  if (
    n.assignedRepId &&
    !ctx.caller.isServiceRole &&
    ctx.caller.role !== "rep" &&
    n.assignedRepId !== ctx.caller.userId
  ) {
    const { data: repRow } = await ctx.admin
      .from("profiles")
      .select("id, workspace_id")
      .eq("id", n.assignedRepId)
      .maybeSingle();
    const repWorkspace = (repRow as { workspace_id?: string } | null)
      ?.workspace_id;
    if (repWorkspace && repWorkspace !== ctx.workspaceId) {
      throw new Error("rep not in workspace");
    }
  }

  const payload: MoveCreatePayload = {
    kind: n.kind,
    title: n.title,
    rationale: n.rationale,
    priority: n.priority,
    entityType: n.entityType,
    entityId: n.entityId,
    assignedRepId: n.assignedRepId,
    dueAt: n.dueAt,
    recommender: "ask_iron",
    recommenderVersion: "v1",
    payload: {
      proposed_via: "ask_iron",
      proposed_at: new Date().toISOString(),
      proposer_user_id: ctx.caller.userId,
    },
  };

  const row = await createMove(ctx, payload);
  return {
    move: {
      id: row.id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assigned_rep_id: row.assigned_rep_id,
      entity: row.entity_type && row.entity_id
        ? { type: row.entity_type, id: row.entity_id }
        : null,
      due_at: row.due_at,
    },
  };
}

// ── System prompt ───────────────────────────────────────────────────────────

export const ASK_IRON_SYSTEM_PROMPT = `You are Iron, the ambient agent for QRM — the operating system for an equipment and parts dealership. You help salesmen, service operators, and dealership managers move work forward.

Your job: answer the operator's question using the tools. These are busy people in trucks, in the yard, between calls. Give them the answer, not your process.

Rules:
- Use tools. Never guess deal amounts, contact names, move counts, signal kinds, or dates.
- If the question names a customer or a contact, call search_entities first, then drill in.
- For "what should I do", call list_my_moves.
- For "what changed" or "anything new", call list_recent_signals.
- When the operator explicitly asks to queue an action — "add a follow-up", "remind me to call", "put a field visit on Wednesday" — call propose_move. Look up the entity with search_entities first so the move is scoped correctly. Do NOT propose moves proactively; only when explicitly requested. You may propose at most 3 moves per turn.
- If a tool returns zero results, say so plainly ("No open moves on your queue") — don't invent.
- Ground every number and name in tool output. If you can't, omit the claim.
- Reply in 2-6 sentences of tight prose. Only bullet when listing 3+ discrete items.
- Address the operator directly ("you", "your"). No preamble, no "Great question", no sign-off.
- Money as "$X" or "$X.XK/$X.XM". No trailing cents on large numbers.

If the question is ambiguous, pick the most-likely interpretation and answer it, then offer to drill further.`;
