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
  {
    // Slice 10: a synthesizer tool for narrative deal questions. Before
    // this tool, "what's the story on Acme?" forced Claude to chain
    // get_deal_detail + list_recent_signals + (maybe) list_my_moves in
    // three LLM turns. summarize_deal bundles all three in one round trip,
    // scoped to the deal, capped for context, and ready for prose.
    name: "summarize_deal",
    description:
      "Bundle a deal's current row, recent activities, and open signals into one call. Use for narrative questions — 'what's the story on <deal>', 'where does this deal stand', 'brief me on <deal>', 'status of <deal>'. Do NOT use for single-field lookups (call get_deal_detail instead) or for listing all deals (call search_entities). Returns structured data — write the summary yourself in 2–4 sentences.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: {
          type: "string",
          description:
            "UUID of the deal to summarize. Obtain from search_entities or list_my_moves if only the name is known.",
        },
        lookback_days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description:
            "How many days of activities and signals to pull. Default 30 — enough to cover a typical sales cycle without blowing context.",
        },
      },
      required: ["deal_id"],
    },
  },
  {
    // Slice 14: the morning-briefing synthesizer. Pulls four arms into one
    // round-trip so Claude can answer "what's on my plate" / "brief me on
    // my day" without chaining list_my_moves + list_my_touches +
    // list_recent_signals + a completed-moves query across four turns.
    //
    //   1. active_moves      — suggested + accepted, priority desc
    //   2. completed_today   — moves the rep closed inside the window
    //   3. recent_touches    — the rep's outbound log (same shape as
    //                           list_my_touches)
    //   4. open_signals      — medium+ severity signals in the window
    //
    // Rep callers are always pinned to their own userId; managers may
    // target a specific rep via rep_id (with the same cross-workspace
    // guard used by list_my_moves / list_my_touches / propose_move).
    //
    // Scope note: open_signals is workspace-wide, not rep-scoped — a rep
    // briefing also wants to know if something signal-worthy hit the
    // workspace even if it isn't pinned to one of their deals yet. The
    // returned payload labels this explicitly so the LLM doesn't claim
    // "no signals on your accounts".
    name: "summarize_day",
    description:
      "Morning-briefing bundle for the caller. Returns active moves (suggested + accepted), moves completed in the window, the rep's recent outbound touches, and workspace signals at medium+ severity — all scoped to the last lookback_hours. Use for 'what's on my plate this morning', 'brief me on my day', 'where should I start', 'catch me up'. Do NOT use for narrower questions — for just moves call list_my_moves, for just touches call list_my_touches, for just signals call list_recent_signals. Returns structured data — write the briefing yourself in 2–4 sentences. open_signals is workspace-wide (not just this rep's accounts).",
    input_schema: {
      type: "object",
      properties: {
        lookback_hours: {
          type: "integer",
          minimum: 1,
          maximum: 168,
          description:
            "Window to pull completed moves, recent touches, and signals from. Default 24 (one day). Use 72 for 'what happened while I was out Friday'.",
        },
        rep_id: {
          type: "string",
          description:
            "UUID of a rep. Admins/managers use this to answer 'how's Jim's day looking'. Reps are always scoped to themselves.",
        },
      },
    },
  },
  {
    // Slice 13: the rep's own activity trail. Before this tool, Iron could
    // see moves (recommender output) and signals (inbound events) but had
    // zero visibility into what the rep actually did. "Did I call Acme this
    // week?" forced Claude to fudge or apologize. list_my_touches pulls
    // the crm_activities rows authored by the caller (rep pins to self;
    // managers may query a specific rep_id), scoped by workspace and
    // optionally by entity or activity_type.
    //
    // Distinct from list_recent_signals: that's the inbound event stream
    // (emails coming in, telematics firing, etc.). list_my_touches is the
    // outbound log — what the operator logged themselves.
    name: "list_my_touches",
    description:
      "Recent activity trail for the caller — calls, emails, notes, follow-ups, meetings, tasks they've logged. Use for 'did I call <customer>', 'what did I do yesterday', 'any touches on <deal>', 'how many follow-ups this week'. Rep callers always see their own trail; admins/managers may pass rep_id to inspect another rep. Distinct from list_recent_signals: this is the operator's outbound log, not the inbound event stream.",
    input_schema: {
      type: "object",
      properties: {
        since_hours: {
          type: "integer",
          minimum: 1,
          maximum: 168,
          description:
            "Only touches within the last N hours. Default 72 (covers a typical work-week).",
        },
        activity_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter to these activity types, e.g. ['call','follow_up','meeting']. Omit for all types.",
        },
        entity_type: {
          type: "string",
          enum: ["deal", "company", "contact"],
          description:
            "Narrow to touches tied to this entity. Requires entity_id.",
        },
        entity_id: {
          type: "string",
          description: "UUID for the entity scope. Pairs with entity_type.",
        },
        rep_id: {
          type: "string",
          description:
            "UUID of a rep. Admins/managers use this to answer 'what has Jim done this week'. Reps are always scoped to themselves regardless of this field.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    // Slice 11: account-centric mirror of summarize_deal. Equipment/parts
    // dealerships run on accounts (territories = companies, not deals), so
    // "what's going on at Acme?" is the single most common narrative
    // question from a rep pulling into a yard. This tool answers it in one
    // round-trip instead of chaining get_company_detail + search_entities
    // (for open deals) + list_recent_signals.
    //
    // Visibility note: open_deals comes from crm_deals_rep_safe, which
    // applies the rep-vs-company-deals RLS rules. A rep summarizing a
    // company may see a partial list — the prompt tells Claude not to
    // claim "no other deals" since what's visible is a slice, not the
    // ground truth.
    name: "summarize_company",
    description:
      "Bundle a company's row, open deals, recent activities across all of its contacts, and active signals into one call. Use for narrative account questions — 'what's going on at <company>', 'brief me on <company>', 'status at <company>', 'what's happening at Acme'. Distinguish from summarize_deal: deal = one opportunity, company = whole account. Do NOT use for single-field lookups (call get_company_detail instead). Returns structured data — write the summary yourself in 2–4 sentences. Note: open_deals may be a partial list for rep callers due to deal visibility rules; describe it as 'deals you can see' not 'all deals'.",
    input_schema: {
      type: "object",
      properties: {
        company_id: {
          type: "string",
          description:
            "UUID of the company to summarize. Obtain from search_entities if only the name is known.",
        },
        lookback_days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description:
            "How many days of activities and signals to pull. Default 30.",
        },
      },
      required: ["company_id"],
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

// ── summarize_deal normalization ───────────────────────────────────────────

export interface NormalizedSummarizeDeal {
  dealId: string;
  lookbackDays: number;
  sinceIso: string;
}

export const SUMMARIZE_DEAL_DEFAULT_DAYS = 30;
export const SUMMARIZE_DEAL_MAX_DAYS = 90;
export const SUMMARIZE_DEAL_MIN_DAYS = 1;
/**
 * Row caps for the two list arms of summarize_deal. These are hard caps to
 * keep the tool result small enough for Claude's context even on a chatty
 * deal with a long lookback window — the LLM rarely needs more than the
 * 10 most recent items to write a useful status paragraph, and fetching
 * more only inflates token cost without improving the summary.
 */
export const SUMMARIZE_DEAL_ACTIVITY_LIMIT = 10;
export const SUMMARIZE_DEAL_SIGNAL_LIMIT = 10;
/**
 * Per-field text truncation applied to activity bodies and signal
 * descriptions before we hand them to Claude. 240 matches the Slice 8
 * triage-prompt cap for signal descriptions — same reasoning: the model
 * needs a hint, not a transcript.
 */
export const SUMMARIZE_DEAL_TEXT_CAP = 240;

/**
 * Validate + normalize the LLM-supplied `summarize_deal` input. Throws
 * VALIDATION_ERROR when deal_id is missing so the caller returns a clean
 * tool error Claude can recover from.
 */
export function normalizeSummarizeDealInput(
  input: Record<string, unknown>,
  nowMs: number = Date.now(),
): NormalizedSummarizeDeal {
  const dealId = typeof input.deal_id === "string" ? input.deal_id.trim() : "";
  if (!dealId) throw new Error("VALIDATION_ERROR:deal_id");

  const raw = Number(input.lookback_days ?? SUMMARIZE_DEAL_DEFAULT_DAYS);
  const lookbackDays = Number.isFinite(raw)
    ? Math.min(
        Math.max(Math.trunc(raw), SUMMARIZE_DEAL_MIN_DAYS),
        SUMMARIZE_DEAL_MAX_DAYS,
      )
    : SUMMARIZE_DEAL_DEFAULT_DAYS;

  const sinceIso = new Date(nowMs - lookbackDays * 24 * 3_600_000).toISOString();
  return { dealId, lookbackDays, sinceIso };
}

// ── summarize_company normalization (Slice 11) ─────────────────────────────

export interface NormalizedSummarizeCompany {
  companyId: string;
  lookbackDays: number;
  sinceIso: string;
}

/**
 * Row cap for the `open_deals` list arm of summarize_company. Separate
 * constant from the activity cap because deals are a different density
 * signal — a company with 15 deals is a big-account flag, but 15 messages
 * of prose would blow the context budget.
 */
export const SUMMARIZE_COMPANY_DEAL_LIMIT = 10;

/**
 * Validate + normalize LLM-supplied `summarize_company` input. Same clamp
 * window as summarize_deal so operators don't have to remember two
 * different defaults. Throws on missing/empty company_id so Claude gets
 * a clean error it can recover from.
 */
export function normalizeSummarizeCompanyInput(
  input: Record<string, unknown>,
  nowMs: number = Date.now(),
): NormalizedSummarizeCompany {
  const companyId = typeof input.company_id === "string"
    ? input.company_id.trim()
    : "";
  if (!companyId) throw new Error("VALIDATION_ERROR:company_id");

  const raw = Number(input.lookback_days ?? SUMMARIZE_DEAL_DEFAULT_DAYS);
  const lookbackDays = Number.isFinite(raw)
    ? Math.min(
        Math.max(Math.trunc(raw), SUMMARIZE_DEAL_MIN_DAYS),
        SUMMARIZE_DEAL_MAX_DAYS,
      )
    : SUMMARIZE_DEAL_DEFAULT_DAYS;

  const sinceIso = new Date(nowMs - lookbackDays * 24 * 3_600_000).toISOString();
  return { companyId, lookbackDays, sinceIso };
}

// ── list_my_touches normalization (Slice 13) ───────────────────────────────

export interface NormalizedTouchFilters {
  sinceIso: string;
  limit: number;
  activityTypes: string[];
  entityType: "deal" | "company" | "contact" | null;
  entityId: string | null;
  /**
   * When null, the executor returns touches authored by anyone in the
   * workspace (elevated callers who omit rep_id). For rep callers this is
   * always pinned to their own userId — the enforcement lives in the
   * normalizer, not the executor, so the rule is auditable in one place.
   */
  repId: string | null;
}

export const LIST_MY_TOUCHES_DEFAULT_HOURS = 72;
export const LIST_MY_TOUCHES_DEFAULT_LIMIT = 20;
export const LIST_MY_TOUCHES_MAX_LIMIT = 50;
/**
 * Per-field body truncation for returned touches. Matches the
 * summarize_deal cap so Claude's context budget is predictable when
 * Iron bundles list_my_touches with a summarize_* tool.
 */
export const LIST_MY_TOUCHES_TEXT_CAP = 240;

const ALLOWED_TOUCH_ENTITY_TYPES = new Set<"deal" | "company" | "contact">([
  "deal",
  "company",
  "contact",
]);

/**
 * Validate + normalize the LLM-supplied `list_my_touches` input. This is a
 * read-only tool, so we prefer "silently widen" over "throw" for
 * recoverable validation problems — a half-scoped entity filter becomes
 * "no entity filter" rather than a hard error. The one enforcement that
 * DOES bite is rep-pinning: rep callers always get `repId = caller.userId`
 * regardless of what the model passed, same rule as list_my_moves.
 */
export function normalizeListMyTouchesInput(
  input: Record<string, unknown>,
  ctx: RouterCtx,
  nowMs: number = Date.now(),
): NormalizedTouchFilters {
  const hoursRaw = Number(input.since_hours ?? LIST_MY_TOUCHES_DEFAULT_HOURS);
  const hours = Number.isFinite(hoursRaw)
    ? Math.min(Math.max(Math.trunc(hoursRaw), 1), 168)
    : LIST_MY_TOUCHES_DEFAULT_HOURS;
  const sinceIso = new Date(nowMs - hours * 3_600_000).toISOString();

  const limitRaw = Number(input.limit ?? LIST_MY_TOUCHES_DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), LIST_MY_TOUCHES_MAX_LIMIT)
    : LIST_MY_TOUCHES_DEFAULT_LIMIT;

  const rawTypes = Array.isArray(input.activity_types) ? input.activity_types : [];
  const activityTypes = rawTypes
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());

  // Entity scope: requires BOTH type and id. Unlike propose_move (which
  // throws on partial scope because the write is destructive), a read with
  // a half-scope is safely dropped: the LLM gets a wider answer and can
  // narrow it on the next turn.
  const rawEntityType = typeof input.entity_type === "string"
    ? input.entity_type
    : null;
  const validEntityType = rawEntityType &&
      ALLOWED_TOUCH_ENTITY_TYPES.has(
        rawEntityType as "deal" | "company" | "contact",
      )
    ? (rawEntityType as "deal" | "company" | "contact")
    : null;
  const rawEntityId = typeof input.entity_id === "string"
      && input.entity_id.trim().length > 0
    ? input.entity_id.trim()
    : null;
  const entityType = validEntityType && rawEntityId ? validEntityType : null;
  const entityId = validEntityType && rawEntityId ? rawEntityId : null;

  // Rep pinning — identical rule to normalizeMoveFilters.
  const requestedRepId =
    typeof input.rep_id === "string" && input.rep_id.length > 0
      ? input.rep_id
      : null;
  const repId = !ctx.caller.isServiceRole && ctx.caller.role === "rep"
    ? ctx.caller.userId
    : requestedRepId;

  return { sinceIso, limit, activityTypes, entityType, entityId, repId };
}

// ── summarize_day normalization (Slice 14) ─────────────────────────────────

export interface NormalizedSummarizeDay {
  sinceIso: string;
  lookbackHours: number;
  repId: string | null;
}

export const SUMMARIZE_DAY_DEFAULT_HOURS = 24;
/**
 * Hard caps on each list arm of the day-briefing. Kept uniform with the
 * existing synthesizers so the LLM's context budget is predictable — it
 * sees at most 10 of each thing regardless of lookback window.
 */
export const SUMMARIZE_DAY_MOVE_LIMIT = 10;
export const SUMMARIZE_DAY_COMPLETED_LIMIT = 10;
export const SUMMARIZE_DAY_TOUCH_LIMIT = 10;
export const SUMMARIZE_DAY_SIGNAL_LIMIT = 10;

/**
 * Validate + normalize the LLM-supplied `summarize_day` input. Rep
 * callers always get `repId = caller.userId` regardless of what the
 * model passed — same rule as list_my_moves / list_my_touches.
 *
 * No VALIDATION_ERROR cases here: a bad lookback clamps to the default,
 * an invalid rep_id is either ignored (elevated callers can omit to
 * default null) or overridden to self (rep callers). The cross-workspace
 * rep check still runs in the executor.
 */
export function normalizeSummarizeDayInput(
  input: Record<string, unknown>,
  ctx: RouterCtx,
  nowMs: number = Date.now(),
): NormalizedSummarizeDay {
  const hoursRaw = Number(input.lookback_hours ?? SUMMARIZE_DAY_DEFAULT_HOURS);
  const lookbackHours = Number.isFinite(hoursRaw)
    ? Math.min(Math.max(Math.trunc(hoursRaw), 1), 168)
    : SUMMARIZE_DAY_DEFAULT_HOURS;
  const sinceIso = new Date(nowMs - lookbackHours * 3_600_000).toISOString();

  const requestedRepId =
    typeof input.rep_id === "string" && input.rep_id.length > 0
      ? input.rep_id
      : null;
  const repId = !ctx.caller.isServiceRole && ctx.caller.role === "rep"
    ? ctx.caller.userId
    : requestedRepId;

  return { sinceIso, lookbackHours, repId };
}

// Shrink a potentially-long free-text field to keep the tool result small.
// Single place to change the truncation rule so both activity.body and
// signal.description cap identically.
function truncateForSummary(raw: unknown, max: number = SUMMARIZE_DEAL_TEXT_CAP): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + "…";
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
      case "summarize_deal":
        return { ok: true, data: await toolSummarizeDeal(ctx, input) };
      case "summarize_company":
        return { ok: true, data: await toolSummarizeCompany(ctx, input) };
      case "list_my_touches":
        return { ok: true, data: await toolListMyTouches(ctx, input) };
      case "summarize_day":
        return { ok: true, data: await toolSummarizeDay(ctx, input) };
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
 * Slice 10 — synthesizer tool for narrative deal questions.
 *
 * Bundles the deal row + recent activities + open signals into one tool
 * result so Claude can write a 2–4 sentence status paragraph without
 * chaining multiple tool calls across turns.
 *
 * Scoping & RLS:
 *   - Deal row comes from `crm_deals_rep_safe` — the rep-safe view, same
 *     surface get_deal_detail / search_entities use. Respects the
 *     rep-vs-company-deals visibility rules baked into the view.
 *   - Activities come from `crm_activities` via `ctx.callerDb` with an
 *     explicit workspace_id + deal_id filter. The `deleted_at is null`
 *     clause matches every other activity read in this module.
 *   - Signals use the same `signals` table + query shape as
 *     toolListRecentSignals, with the added entity_type='deal' filter.
 *
 * Returns `{ found: false }` when the deal doesn't exist OR when the rep
 * can't see it — the view handles the latter by returning an empty row set.
 */
async function toolSummarizeDeal(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const n = normalizeSummarizeDealInput(input);

  // 1) Deal row — workspace-scoped read. If the view filters out a deal
  // this rep can't see, maybeSingle returns null and we short-circuit
  // before spending the activity/signal round-trips.
  const { data: dealRow, error: dealErr } = await ctx.callerDb
    .from("crm_deals_rep_safe")
    .select(
      "id, name, amount, stage, expected_close_on, assigned_rep_id, company_id, updated_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", n.dealId)
    .maybeSingle();
  if (dealErr) throw dealErr;
  if (!dealRow) {
    return {
      found: false,
      lookback_days: n.lookbackDays,
    };
  }

  // 2) Recent activities on this deal within the lookback window. Hard
  // cap at SUMMARIZE_DEAL_ACTIVITY_LIMIT regardless of lookback_days.
  const { data: activityRows, error: activityErr } = await ctx.callerDb
    .from("crm_activities")
    .select("id, activity_type, body, occurred_at, created_by")
    .eq("workspace_id", ctx.workspaceId)
    .eq("deal_id", n.dealId)
    .is("deleted_at", null)
    .gte("occurred_at", n.sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(SUMMARIZE_DEAL_ACTIVITY_LIMIT);
  if (activityErr) throw activityErr;

  // 3) Signals tied to this deal within the lookback window. The
  // signals table pairs entity_type='deal' with entity_id=dealId for the
  // deal-scoped stream; filtering both makes the index work.
  const { data: signalRows, error: signalErr } = await ctx.callerDb
    .from("signals")
    .select("id, kind, severity, source, title, description, occurred_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("entity_type", "deal")
    .eq("entity_id", n.dealId)
    .gte("occurred_at", n.sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(SUMMARIZE_DEAL_SIGNAL_LIMIT);
  if (signalErr) throw signalErr;

  const activities = (activityRows ?? []).map((row) => ({
    id: row.id,
    activity_type: row.activity_type,
    body: truncateForSummary(row.body),
    occurred_at: row.occurred_at,
    created_by: row.created_by,
  }));

  const signals = (signalRows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    source: row.source,
    title: row.title,
    description: truncateForSummary(row.description),
    occurred_at: row.occurred_at,
  }));

  return {
    found: true,
    lookback_days: n.lookbackDays,
    deal: dealRow,
    recent_activities: activities,
    open_signals: signals,
    counts: {
      activities: activities.length,
      signals: signals.length,
    },
  };
}

/**
 * Slice 11 — account-level synthesizer. Mirror of toolSummarizeDeal, but
 * scoped to a company rather than a single opportunity. Four parallel-ish
 * reads (we keep them sequential for readability; individually they're all
 * ms-scale on indexed columns):
 *
 *   1. Company row           — crm_companies
 *   2. Open deals            — crm_deals_rep_safe filtered by company_id
 *   3. Recent activities     — crm_activities filtered by company_id
 *   4. Open signals          — signals filtered by entity_type='company'
 *
 * All four queries go through callerDb with explicit workspace_id so RLS
 * does the tenant work. The company row short-circuits the downstream
 * reads when it's missing (either deleted or the caller can't see it via
 * their workspace) — same pattern as summarize_deal.
 *
 * Visibility nuance: crm_deals_rep_safe is rep-safe — a rep summarizing
 * a company sees only the deals they own + unassigned-company deals per
 * the view's rules. The tool description tells Claude to call open_deals
 * "deals you can see," not the ground truth of the account.
 */
async function toolSummarizeCompany(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const n = normalizeSummarizeCompanyInput(input);

  // 1) Company row — workspace-scoped + soft-delete guard.
  const { data: companyRow, error: companyErr } = await ctx.callerDb
    .from("crm_companies")
    .select("id, name, city, state, country, industry, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", n.companyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (companyErr) throw companyErr;
  if (!companyRow) {
    return {
      found: false,
      lookback_days: n.lookbackDays,
    };
  }

  // 2) Open deals for this company. crm_deals_rep_safe handles the
  // rep-visibility rule; we just filter by company_id. "Open" is
  // intentionally fuzzy here — we return all rows the view lets through,
  // sorted by updated_at so the most-active appear first. If the sales
  // pipeline ever adds a canonical `is_open` flag, tighten this.
  const { data: dealRows, error: dealsErr } = await ctx.callerDb
    .from("crm_deals_rep_safe")
    .select(
      "id, name, amount, stage, expected_close_on, assigned_rep_id, updated_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("company_id", n.companyId)
    .order("updated_at", { ascending: false })
    .limit(SUMMARIZE_COMPANY_DEAL_LIMIT);
  if (dealsErr) throw dealsErr;

  // 3) Recent activities at the company-scope. crm_activities carries
  // a company_id column directly so we don't need to fan through deals
  // or contacts to find account-level touches.
  const { data: activityRows, error: activityErr } = await ctx.callerDb
    .from("crm_activities")
    .select("id, activity_type, body, occurred_at, created_by, deal_id, contact_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("company_id", n.companyId)
    .is("deleted_at", null)
    .gte("occurred_at", n.sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(SUMMARIZE_DEAL_ACTIVITY_LIMIT);
  if (activityErr) throw activityErr;

  // 4) Signals tied to this company. Same entity_type/entity_id shape
  // as summarize_deal, flipped to 'company'.
  const { data: signalRows, error: signalErr } = await ctx.callerDb
    .from("signals")
    .select("id, kind, severity, source, title, description, occurred_at")
    .eq("workspace_id", ctx.workspaceId)
    .eq("entity_type", "company")
    .eq("entity_id", n.companyId)
    .gte("occurred_at", n.sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(SUMMARIZE_DEAL_SIGNAL_LIMIT);
  if (signalErr) throw signalErr;

  const deals = dealRows ?? [];
  const activities = (activityRows ?? []).map((row) => ({
    id: row.id,
    activity_type: row.activity_type,
    body: truncateForSummary(row.body),
    occurred_at: row.occurred_at,
    created_by: row.created_by,
    deal_id: row.deal_id,
    contact_id: row.contact_id,
  }));
  const signals = (signalRows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    source: row.source,
    title: row.title,
    description: truncateForSummary(row.description),
    occurred_at: row.occurred_at,
  }));

  return {
    found: true,
    lookback_days: n.lookbackDays,
    company: companyRow,
    open_deals: deals,
    recent_activities: activities,
    open_signals: signals,
    counts: {
      deals: deals.length,
      activities: activities.length,
      signals: signals.length,
    },
  };
}

/**
 * Slice 13 — the rep's own activity trail.
 *
 * Reads crm_activities filtered by workspace + soft-delete + caller's
 * lookback window. Rep callers are pinned to their own userId upstream;
 * elevated callers may scope to another rep via rep_id (with a workspace
 * membership guard, same pattern as toolListMyMoves).
 *
 * The entity scope is optional. When provided, the normalizer has
 * already validated that both type and id are present — we just map the
 * type to the correct column and add an `eq`. If the caller leaves
 * activity_types empty, we return every type that crm_activities carries
 * (including system-generated rows like 'enrollment_created' or
 * 'service_prompt'). Iron's system prompt nudges the LLM toward a
 * canonical touches subset when the question is "what did I do".
 */
async function toolListMyTouches(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const f = normalizeListMyTouchesInput(input, ctx);

  // Cross-tenant read guard. Elevated callers who targeted another rep id
  // get a workspace-membership check before we pull their activity trail.
  // Reps are already pinned to their own userId upstream, so this branch
  // only runs for admin/manager/owner callers.
  if (
    f.repId &&
    !ctx.caller.isServiceRole &&
    ctx.caller.role !== "rep" &&
    f.repId !== ctx.caller.userId
  ) {
    const { data: repRow } = await ctx.admin
      .from("profiles")
      .select("id, workspace_id")
      .eq("id", f.repId)
      .maybeSingle();
    const repWorkspace = (repRow as { workspace_id?: string } | null)
      ?.workspace_id;
    if (repWorkspace && repWorkspace !== ctx.workspaceId) {
      throw new Error("rep not in workspace");
    }
  }

  let q = ctx.callerDb
    .from("crm_activities")
    .select(
      "id, activity_type, body, occurred_at, created_by, deal_id, company_id, contact_id",
    )
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .gte("occurred_at", f.sinceIso);

  if (f.repId) q = q.eq("created_by", f.repId);
  if (f.activityTypes.length > 0) q = q.in("activity_type", f.activityTypes);
  if (f.entityType && f.entityId) {
    const column = f.entityType === "deal"
      ? "deal_id"
      : f.entityType === "company"
      ? "company_id"
      : "contact_id";
    q = q.eq(column, f.entityId);
  }

  const { data, error } = await q
    .order("occurred_at", { ascending: false })
    .limit(f.limit);
  if (error) throw error;

  const touches = (data ?? []).map((row) => ({
    id: row.id,
    activity_type: row.activity_type,
    body: truncateForSummary(row.body, LIST_MY_TOUCHES_TEXT_CAP),
    occurred_at: row.occurred_at,
    created_by: row.created_by,
    deal_id: row.deal_id,
    company_id: row.company_id,
    contact_id: row.contact_id,
  }));

  return { touches, count: touches.length };
}

/**
 * Slice 14 — morning-briefing synthesizer.
 *
 * Bundles four reads into one tool result so Claude can write a day
 * briefing in a single turn:
 *
 *   1. active_moves       moves (suggested + accepted) for this rep,
 *                         priority-desc. Uses the admin client because
 *                         moves live outside callerDb's RLS today (same
 *                         pattern as toolListMyMoves).
 *   2. completed_today    moves with status=completed whose
 *                         completed_at falls inside the window. Same
 *                         table + client as active_moves; the filter
 *                         swap is the only difference.
 *   3. recent_touches     crm_activities authored by this rep inside
 *                         the window, via callerDb. Body text capped.
 *   4. open_signals       signals in the window at medium+ severity,
 *                         workspace-wide (NOT rep-scoped). The tool
 *                         description tells Claude to describe this as
 *                         workspace-wide so it doesn't undersell the
 *                         briefing.
 *
 * Rep callers are pinned to self upstream; elevated callers who pass
 * rep_id go through the same profiles workspace-membership check as
 * list_my_moves / list_my_touches / propose_move.
 */
async function toolSummarizeDay(
  ctx: RouterCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const n = normalizeSummarizeDayInput(input, ctx);

  // Cross-tenant read guard. Only elevated callers targeting someone
  // other than themselves actually hit the profiles check.
  if (
    n.repId &&
    !ctx.caller.isServiceRole &&
    ctx.caller.role !== "rep" &&
    n.repId !== ctx.caller.userId
  ) {
    const { data: repRow } = await ctx.admin
      .from("profiles")
      .select("id, workspace_id")
      .eq("id", n.repId)
      .maybeSingle();
    const repWorkspace = (repRow as { workspace_id?: string } | null)
      ?.workspace_id;
    if (repWorkspace && repWorkspace !== ctx.workspaceId) {
      throw new Error("rep not in workspace");
    }
  }

  // 1) Active moves for this rep (or everyone, if elevated + repId null).
  let activeQ = ctx.admin
    .from("moves")
    .select(
      "id, kind, status, title, rationale, priority, entity_type, entity_id, assigned_rep_id, due_at, created_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .in("status", ["suggested", "accepted"]);
  if (n.repId) activeQ = activeQ.eq("assigned_rep_id", n.repId);
  const { data: activeRows, error: activeErr } = await activeQ
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SUMMARIZE_DAY_MOVE_LIMIT);
  if (activeErr) throw activeErr;

  // 2) Completed inside the window. completed_at is the source of truth
  // for "closed today" — created_at would double-count stale moves
  // cleared this morning.
  let completedQ = ctx.admin
    .from("moves")
    .select(
      "id, kind, title, priority, entity_type, entity_id, assigned_rep_id, completed_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .eq("status", "completed")
    .gte("completed_at", n.sinceIso);
  if (n.repId) completedQ = completedQ.eq("assigned_rep_id", n.repId);
  const { data: completedRows, error: completedErr } = await completedQ
    .order("completed_at", { ascending: false })
    .limit(SUMMARIZE_DAY_COMPLETED_LIMIT);
  if (completedErr) throw completedErr;

  // 3) Recent touches. When repId is null (elevated caller + no target),
  // we widen to workspace-level activity — a workspace briefing is still
  // useful even if it's not rep-scoped.
  let touchQ = ctx.callerDb
    .from("crm_activities")
    .select(
      "id, activity_type, body, occurred_at, created_by, deal_id, company_id, contact_id",
    )
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .gte("occurred_at", n.sinceIso);
  if (n.repId) touchQ = touchQ.eq("created_by", n.repId);
  const { data: touchRows, error: touchErr } = await touchQ
    .order("occurred_at", { ascending: false })
    .limit(SUMMARIZE_DAY_TOUCH_LIMIT);
  if (touchErr) throw touchErr;

  // 4) Open signals (workspace-wide, medium+). Not rep-filtered on
  // purpose — a rep briefing benefits from knowing what landed on the
  // yard's radar even if it isn't yet tied to one of their deals.
  const signalSeverities = ["medium", "high", "critical"];
  const { data: signalRows, error: signalErr } = await ctx.callerDb
    .from("signals")
    .select(
      "id, kind, severity, source, title, description, entity_type, entity_id, occurred_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .gte("occurred_at", n.sinceIso)
    .in("severity", signalSeverities)
    .order("occurred_at", { ascending: false })
    .limit(SUMMARIZE_DAY_SIGNAL_LIMIT);
  if (signalErr) throw signalErr;

  const activeMoves = (activeRows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    rationale: truncateForSummary(row.rationale),
    priority: row.priority,
    entity: row.entity_type && row.entity_id
      ? { type: row.entity_type, id: row.entity_id }
      : null,
    assigned_rep_id: row.assigned_rep_id,
    due_at: row.due_at,
  }));

  const completedToday = (completedRows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    priority: row.priority,
    entity: row.entity_type && row.entity_id
      ? { type: row.entity_type, id: row.entity_id }
      : null,
    assigned_rep_id: row.assigned_rep_id,
    completed_at: row.completed_at,
  }));

  const recentTouches = (touchRows ?? []).map((row) => ({
    id: row.id,
    activity_type: row.activity_type,
    body: truncateForSummary(row.body),
    occurred_at: row.occurred_at,
    created_by: row.created_by,
    deal_id: row.deal_id,
    company_id: row.company_id,
    contact_id: row.contact_id,
  }));

  const openSignals = (signalRows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    source: row.source,
    title: row.title,
    description: truncateForSummary(row.description),
    entity: row.entity_type && row.entity_id
      ? { type: row.entity_type, id: row.entity_id }
      : null,
    occurred_at: row.occurred_at,
  }));

  return {
    as_of: new Date().toISOString(),
    lookback_hours: n.lookbackHours,
    rep_id: n.repId,
    active_moves: activeMoves,
    completed_today: completedToday,
    recent_touches: recentTouches,
    open_signals: openSignals,
    counts: {
      active_moves: activeMoves.length,
      completed_today: completedToday.length,
      recent_touches: recentTouches.length,
      open_signals: openSignals.length,
    },
  };
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
- For questions about the operator's own work — "did I call <customer>", "what did I do yesterday", "any touches on <deal> this week", "how many follow-ups" — call list_my_touches. This is the operator's outbound log; it is NOT the same as list_recent_signals (inbound events). For "what did I do" questions where system-generated activity rows would be noise, filter to the touch types operators actually log (activity_types: ['call','email','meeting','follow_up','note']).
- For morning-briefing questions — "what's on my plate", "brief me on my day", "where should I start", "catch me up" — call summarize_day. It bundles active moves, moves completed in the window, recent touches, and workspace signals into one round-trip. Do NOT chain list_my_moves + list_my_touches + list_recent_signals for these questions; summarize_day returns all four in a single call. Note: open_signals in the result is workspace-wide, so describe it as "on the yard's radar" or "across the workspace" rather than "on your accounts".
- For narrative deal questions — "what's the story on X", "where does this deal stand", "brief me on X", "status of X" — call search_entities to get the deal_id, then call summarize_deal. Do not chain get_deal_detail + list_recent_signals for narrative questions; summarize_deal bundles both in one round trip.
- For narrative account questions — "what's going on at <company>", "brief me on <company>", "status at <company>", "anything happening at Acme" — call search_entities to get the company_id, then call summarize_company. Disambiguation rule: if search_entities returns both a deal and a company matching the name, pick by the operator's phrasing — "deal" / "quote" / "pipeline" → summarize_deal; "account" / "at Acme" / "with Acme" / bare company name → summarize_company. When a rep asks about a company, describe open_deals as "deals you can see" — the list may be filtered by your visibility rules.
- When the operator explicitly asks to queue an action — "add a follow-up", "remind me to call", "put a field visit on Wednesday" — call propose_move. Look up the entity with search_entities first so the move is scoped correctly. Do NOT propose moves proactively; only when explicitly requested. You may propose at most 3 moves per turn.
- If a tool returns zero results, say so plainly ("No open moves on your queue") — don't invent.
- Ground every number and name in tool output. If you can't, omit the claim.
- Reply in 2-6 sentences of tight prose. Only bullet when listing 3+ discrete items.
- Address the operator directly ("you", "your"). No preamble, no "Great question", no sign-off.
- Money as "$X" or "$X.XK/$X.XM". No trailing cents on large numbers.

If the question is ambiguous, pick the most-likely interpretation and answer it, then offer to drill further.`;
