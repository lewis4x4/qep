/**
 * Owner Ask Anything — Slice D of the Owner Dashboard moonshot.
 *
 * The owner types one question; Claude Sonnet 4.6 with tool use reaches
 * across parts / CRM / service / finance to answer with real numbers.
 *
 * Tools:
 *   1. get_dashboard_summary        — top-level KPIs
 *   2. search_parts                 — hybrid semantic catalog search
 *   3. search_companies             — by name (qrm_companies)
 *   4. list_deals                   — filter by status/amount/owner
 *   5. recent_predictive_plays      — top open plays by revenue
 *   6. branch_stack_ranking         — per-branch quartiles
 *   7. owner_event_feed             — last 24-72h events
 *
 * Auth: admin/manager/owner (user JWT).
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1536;
const TEMPERATURE = 0.2;
const ANTHROPIC_TIMEOUT_MS = 35_000;
const MAX_TOOL_TURNS = 5;

interface RequestBody {
  question: string;
  history?: { role: "user" | "assistant" | "tool"; content: string }[];
}

type ClaudeMessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: ClaudeMessageContent[] | string;
}

const TOOLS = [
  {
    name: "get_dashboard_summary",
    description:
      "Returns the current top-level KPI payload: revenue (today/MTD/prior), pipeline, parts intelligence signals, AR aging. Call first for any 'how is the business doing' type question.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_parts",
    description:
      "Semantic + full-text hybrid search over the parts catalog. Returns top matches with part_number, description, manufacturer, on_hand, list_price, cost_price. Use when the question names a part, symptom, brand, or category.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description." },
        manufacturer: { type: "string", description: "Optional: Yanmar / Bandit / etc." },
        limit: { type: "integer", minimum: 1, maximum: 15 },
      },
      required: ["query"],
    },
  },
  {
    name: "search_companies",
    description:
      "Look up a customer/company by partial name. Returns id, name, city/state, industry, deal count, lifetime value if available.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["name"],
    },
  },
  {
    name: "list_deals",
    description:
      "List deals in the QRM pipeline filtered by status and/or minimum amount. Use for questions like 'what deals are stalled', 'show me deals over $50K', 'what closed this month'.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "e.g. 'open' (anything not closed), 'closed_won', 'closed_lost', or omit for all",
        },
        min_amount: { type: "number", description: "Minimum dollar amount." },
        stale_days: {
          type: "integer",
          description: "Only deals not updated in this many days (stall detection).",
        },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: "recent_predictive_plays",
    description:
      "Top open predictive plays ordered by projected revenue. Returns part_number, description, customer, projection_window, probability, projected_revenue.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "branch_stack_ranking",
    description:
      "Per-branch inventory value, dead-parts count, at-reorder count with quartile tiers. Use for branch-comparison questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "owner_event_feed",
    description:
      "Notable events from the last N hours (parts orders, predictive plays written, CDK imports, deals closed won).",
    input_schema: {
      type: "object",
      properties: {
        hours_back: { type: "integer", minimum: 1, maximum: 168, description: "Default 24." },
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the AI Chief of Staff for the owner of Quality Equipment & Parts (QEP), a multi-branch equipment dealership (Yanmar, Bandit, ASV, Prinoth, Barko, Peterson).

Your job: answer the owner's question completely using the tools. The owner is busy — give them the answer, not your process.

Rules:
- Use tools. Never guess numbers, prices, part numbers, customer names, or deal counts.
- If a question is broad ("how's the business"), call get_dashboard_summary first, then other tools as needed.
- When multiple tools are useful, call them in parallel when possible.
- If a tool returns zero results, say so plainly ("No open deals match that filter") — don't invent.
- Ground EVERY number you cite in tool output. If you can't, omit the claim.
- Reply in 2-6 sentences of tight prose. Only use bullets when listing 3+ discrete items.
- Address the owner directly ("you", "your"). No preamble, no "Great question", no sign-off.
- Money as "$X" or "$X.XK/$X.XM". No trailing cents on large numbers.
- Part numbers verbatim from tool results. Never paraphrase or reformat.

If the question is ambiguous, pick the most-likely interpretation and answer it, then offer to drill further.`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    if (!["admin", "manager", "owner"].includes(auth.role)) {
      return safeJsonError("owner/admin/manager only", 403, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return safeJsonError("ANTHROPIC_API_KEY not set", 500, origin);

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = (await req.json()) as RequestBody;

    const question = (body.question ?? "").trim();
    if (!question) return safeJsonError("question is required", 400, origin);
    if (question.length > 800) return safeJsonError("question too long", 400, origin);

    const messages: ClaudeMessage[] = [{ role: "user", content: question }];
    const toolTrace: { tool: string; input: unknown; result: unknown }[] = [];
    let finalText = "";
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await callClaude(anthropicKey, messages);
      totalTokensIn += response.tokens_in;
      totalTokensOut += response.tokens_out;

      const toolUses = response.content.filter(
        (c): c is Extract<ClaudeMessageContent, { type: "tool_use" }> => c.type === "tool_use",
      );

      if (toolUses.length === 0) {
        const textPart = response.content.find(
          (c): c is Extract<ClaudeMessageContent, { type: "text" }> => c.type === "text",
        );
        finalText = textPart?.text ?? "";
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ClaudeMessageContent[] = [];
      for (const tu of toolUses) {
        let resultData: unknown = null;
        try {
          resultData = await executeTool(supabase, tu.name, tu.input);
        } catch (err) {
          resultData = { error: (err as Error).message };
        }
        toolTrace.push({ tool: tu.name, input: tu.input, result: resultData });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(resultData).slice(0, 12_000),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return safeJsonOk({
      answer: finalText,
      tool_trace: toolTrace,
      model: CLAUDE_MODEL,
      elapsed_ms: Date.now() - startMs,
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "owner-ask-anything" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

async function callClaude(
  apiKey: string,
  messages: ClaudeMessage[],
): Promise<{ content: ClaudeMessageContent[]; tokens_in: number; tokens_out: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const usage = (data?.usage ?? {}) as Record<string, unknown>;
  return {
    content: (data?.content ?? []) as ClaudeMessageContent[],
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
  };
}

async function executeTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (name === "get_dashboard_summary") {
    const { data, error } = await supabase.rpc("owner_dashboard_summary", {
      p_workspace: null,
    });
    if (error) throw error;
    return data;
  }

  if (name === "search_parts") {
    const query = String(input.query ?? "").trim();
    if (!query) throw new Error("query required");
    const limit = Math.min(15, Math.max(1, Number(input.limit ?? 6)));
    const manufacturer = (input.manufacturer as string | undefined) ?? null;
    const embedding = await embedText(query);
    const vectorLiteral = formatVectorLiteral(embedding);
    const { data, error } = await supabase.rpc("match_parts_hybrid", {
      p_query_embedding: vectorLiteral,
      p_query_text: query,
      p_workspace: null,
      p_manufacturer: manufacturer,
      p_category: null,
      p_alpha: 0.6,
      p_match_count: limit,
    });
    if (error) throw error;
    return {
      matches: (data ?? []).map((r: Record<string, unknown>) => ({
        part_number: r.part_number,
        description: r.description,
        manufacturer: r.manufacturer,
        on_hand: r.on_hand,
        list_price: r.list_price,
        cost_price: r.cost_price,
        hybrid_score: r.hybrid_score,
      })),
    };
  }

  if (name === "search_companies") {
    const q = String(input.name ?? "").trim();
    if (!q) throw new Error("name required");
    const limit = Math.min(10, Math.max(1, Number(input.limit ?? 5)));
    const { data, error } = await supabase
      .from("qrm_companies")
      .select("id, name, city, state, industry")
      .ilike("name", `%${q}%`)
      .is("deleted_at", null)
      .limit(limit);
    if (error) throw error;
    return { matches: data ?? [] };
  }

  if (name === "list_deals") {
    // qrm_deals has stage_id (FK to qrm_deal_stages) + closed_at + assigned_rep_id.
    // We resolve stage names via the join so the owner's LLM gets readable status.
    const limit = Math.min(25, Math.max(1, Number(input.limit ?? 10)));
    const statusFilter = input.status as string | undefined;
    const minAmount = input.min_amount as number | undefined;
    const staleDays = input.stale_days as number | undefined;

    let q = supabase
      .from("qrm_deals")
      .select(
        `id, name, amount, closed_at, created_at, updated_at,
         assigned_rep_id, company_id, stage_id,
         qrm_deal_stages ( name, is_closed_won, is_closed_lost )`,
      )
      .is("deleted_at", null)
      .order("amount", { ascending: false })
      .limit(limit * 3); // over-fetch for post-filter

    if (typeof minAmount === "number") q = q.gte("amount", minAmount);
    if (typeof staleDays === "number") {
      const cutoff = new Date(Date.now() - staleDays * 86400_000).toISOString();
      q = q.lt("updated_at", cutoff);
    }
    if (statusFilter === "open") {
      q = q.is("closed_at", null);
    }

    const { data, error } = await q;
    if (error) throw error;

    const rows = (data ?? []).map((d: Record<string, unknown>) => {
      const stage = (d.qrm_deal_stages as Record<string, unknown> | null) ?? null;
      const derived =
        stage?.is_closed_won ? "closed_won"
        : stage?.is_closed_lost ? "closed_lost"
        : d.closed_at ? "closed"
        : "open";
      return {
        id: d.id,
        name: d.name,
        amount: d.amount,
        status: derived,
        stage_name: stage?.name ?? null,
        closed_at: d.closed_at,
        created_at: d.created_at,
        updated_at: d.updated_at,
        assigned_rep_id: d.assigned_rep_id,
        company_id: d.company_id,
      };
    });

    const filtered =
      statusFilter === "closed_won"
        ? rows.filter((r) => r.status === "closed_won")
        : statusFilter === "closed_lost"
        ? rows.filter((r) => r.status === "closed_lost")
        : statusFilter === "open"
        ? rows.filter((r) => r.status === "open")
        : rows;

    return { deals: filtered.slice(0, limit) };
  }

  if (name === "recent_predictive_plays") {
    const limit = Math.min(20, Math.max(1, Number(input.limit ?? 8)));
    const { data, error } = await supabase
      .from("predicted_parts_plays")
      .select(
        "part_number, part_description, projection_window, probability, projected_revenue, recommended_order_qty, reason, signal_type, created_at",
      )
      .eq("status", "open")
      .order("projected_revenue", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return { plays: data ?? [] };
  }

  if (name === "branch_stack_ranking") {
    const { data, error } = await supabase
      .from("v_branch_stack_ranking")
      .select("*")
      .order("inventory_value", { ascending: false });
    if (error) throw error;
    return { branches: data ?? [] };
  }

  if (name === "owner_event_feed") {
    const hours = Math.min(168, Math.max(1, Number(input.hours_back ?? 24)));
    const { data, error } = await supabase.rpc("owner_event_feed", {
      p_workspace: null,
      p_hours_back: hours,
    });
    if (error) throw error;
    return data;
  }

  throw new Error(`unknown tool: ${name}`);
}
