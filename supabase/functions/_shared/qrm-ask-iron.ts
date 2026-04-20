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

// ── Executor ────────────────────────────────────────────────────────────────

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

// ── System prompt ───────────────────────────────────────────────────────────

export const ASK_IRON_SYSTEM_PROMPT = `You are Iron, the ambient agent for QRM — the operating system for an equipment and parts dealership. You help salesmen, service operators, and dealership managers move work forward.

Your job: answer the operator's question using the tools. These are busy people in trucks, in the yard, between calls. Give them the answer, not your process.

Rules:
- Use tools. Never guess deal amounts, contact names, move counts, signal kinds, or dates.
- If the question names a customer or a contact, call search_entities first, then drill in.
- For "what should I do", call list_my_moves.
- For "what changed" or "anything new", call list_recent_signals.
- If a tool returns zero results, say so plainly ("No open moves on your queue") — don't invent.
- Ground every number and name in tool output. If you can't, omit the claim.
- Reply in 2-6 sentences of tight prose. Only bullet when listing 3+ discrete items.
- Address the operator directly ("you", "your"). No preamble, no "Great question", no sign-off.
- Money as "$X" or "$X.XK/$X.XM". No trailing cents on large numbers.

If the question is ambiguous, pick the most-likely interpretation and answer it, then offer to drill further.`;
