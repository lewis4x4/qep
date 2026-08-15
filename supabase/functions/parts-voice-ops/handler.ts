/**
 * Parts Voice Ops handler — workspace-bound JWT tenant isolation.
 *
 * JWT callers are always scoped to profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot widen or retarget reads
 * or writes. Missing active workspace fails closed (403).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  embedText,
  formatVectorLiteral,
} from "../_shared/openai-embeddings.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.2;
const ANTHROPIC_TIMEOUT_MS = 25_000;
const MAX_TOOL_TURNS = 4;

const COST_IN = 3.0;
const COST_OUT = 15.0;

export interface RequestBody {
  transcript: string;
  transcript_confidence?: number;
  workspace?: unknown;
  workspace_id?: unknown;
  context?: {
    customer_id?: string;
    customer_name?: string;
    last_part?: string;
    branch?: string;
    page?: string;
  };
  json_only?: boolean;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  elapsed_ms: number;
}

interface ClaudeMessage {
  role: "user" | "assistant";
  content: ClaudeMessageContent[] | string;
}

type ClaudeMessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

const TOOLS = [
  {
    name: "lookup_part_semantic",
    description:
      "Search the parts catalog by description, symptom, or loose phrase. Returns top matches with part number, description, list price, and on-hand quantity. Use when the user asks to find a part by what it does or what it's called casually (e.g., 'hydraulic filter for Yanmar', 'the thing that goes in the chipper drum').",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of the part, enriched with any context (make/model) mentioned.",
        },
        manufacturer: {
          type: "string",
          description:
            "Optional: narrow to a specific vendor/manufacturer (e.g., 'Yanmar', 'Bandit').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_part_stock",
    description:
      "Look up an exact part_number and return its current cost, list price, on-hand quantity, bin location, and vendor. Use when the user gives a specific part number (e.g., '129150-35170', 'BK-HYD-4951').",
    input_schema: {
      type: "object",
      properties: {
        part_number: {
          type: "string",
          description: "The exact SKU / part number.",
        },
      },
      required: ["part_number"],
    },
  },
  {
    name: "add_to_replenish_queue",
    description:
      "Add a part to the parts manager's replenishment queue as a draft PO. Use when the user explicitly wants to order more of something (e.g., 'add 10 oil filters to Thursday's order'). Confirm part_number exists via check_part_stock or lookup_part_semantic first when ambiguous.",
    input_schema: {
      type: "object",
      properties: {
        part_number: {
          type: "string",
          description: "Exact part number — must exist in parts_catalog.",
        },
        quantity: {
          type: "integer",
          description: "Number of units to order.",
          minimum: 1,
        },
        note: {
          type: "string",
          description:
            "Optional note about urgency or context (e.g., 'for Johnson's Thursday delivery').",
        },
      },
      required: ["part_number", "quantity"],
    },
  },
  {
    name: "recent_orders_for_part",
    description:
      "Return the last N orders for a given part number, optionally filtered by customer name. Use for questions like 'who ordered this last', 'did Johnson buy these', 'how many has Mike been taking'.",
    input_schema: {
      type: "object",
      properties: {
        part_number: {
          type: "string",
          description: "The exact part number.",
        },
        customer_name: {
          type: "string",
          description: "Optional: partial or full customer name to filter by.",
        },
        limit: {
          type: "integer",
          description: "Max number of recent orders to return (default 5).",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["part_number"],
    },
  },
];

const SYSTEM_PROMPT = `You are a voice assistant for a parts counter rep at QEP, an equipment dealership (Yanmar, Bandit, ASV, Prinoth, Barko, Peterson).

The rep is hands-busy and expects short, spoken responses. They hold the mic, say one thing, and get one answer.

How to respond:
- Keep replies under 2 sentences unless explicitly asked for detail.
- Use tool calls to look up real data — never guess prices, stock, or part numbers.
- Start numeric answers with the number: "Three on hand at six dollars forty-three. Yanmar one-twenty-nine dash thirty-five-one-seventy."
- When a part number is ambiguous, call lookup_part_semantic first, then confirm.
- After a tool succeeds, speak the outcome. Don't narrate your process.
- If the user asks you to ADD something but you're unsure which exact part, say "Found three possible matches. Did you mean A, B, or C?"

Style rules:
- Plain conversational phrasing — the rep will hear it, not read it.
- Speak dollar amounts as "six dollars forty-three" not "$6.43".
- Speak part numbers digit-by-digit for clarity: "one-two-nine-one-five-zero dash three-five-one-seven-zero".
- No markdown, no bullets, no formatting syntax in the spoken response.

When you're done, respond with ONLY the spoken text — no JSON wrapping, no explanations of what you did.`;

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveVoiceOpsWorkspace(params: {
  callerWorkspaceId: string | null;
  requestedWorkspaceId?: string | null;
}):
  | { ok: true; workspaceId: string }
  | { ok: false; status: 403; message: string } {
  const callerWorkspaceId = cleanString(params.callerWorkspaceId);
  if (!callerWorkspaceId) {
    return {
      ok: false,
      status: 403,
      message: "The authenticated user has no active workspace",
    };
  }
  // Body workspace hints are ignored for JWT callers — active_workspace_id is authoritative.
  void params.requestedWorkspaceId;
  return { ok: true, workspaceId: callerWorkspaceId };
}

interface ClaudeResponse {
  content: ClaudeMessageContent[];
  stop_reason: string;
  tokens_in: number;
  tokens_out: number;
}

export async function callClaude(
  apiKey: string,
  messages: ClaudeMessage[],
): Promise<ClaudeResponse> {
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
  const content = (data?.content ?? []) as ClaudeMessageContent[];
  const usage = (data?.usage ?? {}) as Record<string, unknown>;

  return {
    content,
    stop_reason: String(data?.stop_reason ?? ""),
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
  };
}

export interface ExecuteVoiceOpsToolDeps {
  embedText?: typeof embedText;
}

export async function executeVoiceOpsTool(
  supabase: SupabaseClient,
  callerWorkspace: string,
  name: string,
  input: Record<string, unknown>,
  deps: ExecuteVoiceOpsToolDeps = {},
): Promise<unknown> {
  const embed = deps.embedText ?? embedText;

  if (name === "lookup_part_semantic") {
    const query = String(input.query ?? "").trim();
    const manufacturer = (input.manufacturer as string | undefined) ?? null;
    if (!query) throw new Error("query required");

    const embedding = await embed(query);
    const vectorLiteral = formatVectorLiteral(embedding);

    const { data, error } = await supabase.rpc("match_parts_hybrid", {
      p_query_embedding: vectorLiteral,
      p_query_text: query,
      p_workspace: callerWorkspace,
      p_manufacturer: manufacturer,
      p_category: null,
      p_alpha: 0.6,
      p_match_count: 5,
    });
    if (error) throw error;
    return {
      matches: (data ?? []).map((r: Record<string, unknown>) => ({
        part_number: r.part_number,
        description: r.description,
        manufacturer: r.manufacturer,
        vendor_code: r.vendor_code,
        on_hand: r.on_hand,
        list_price: r.list_price,
        cost_price: r.cost_price,
        cosine_similarity: r.cosine_similarity,
      })),
    };
  }

  if (name === "check_part_stock") {
    const pn = String(input.part_number ?? "").trim();
    if (!pn) throw new Error("part_number required");
    const { data, error } = await supabase
      .from("parts_catalog")
      .select(
        "part_number, description, manufacturer, vendor_code, on_hand, list_price, cost_price, bin_location, branch_code",
      )
      .eq("workspace_id", callerWorkspace)
      .ilike("part_number", pn)
      .is("deleted_at", null)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return { found: false, part_number: pn };
    return { found: true, ...data[0] };
  }

  if (name === "add_to_replenish_queue") {
    const pn = String(input.part_number ?? "").trim();
    const qty = Number(input.quantity ?? 0);
    const note = (input.note as string | undefined) ?? null;
    if (!pn || qty <= 0) {
      throw new Error("part_number and positive quantity required");
    }

    const { data: part, error: partErr } = await supabase
      .from("parts_catalog")
      .select(
        "id, part_number, list_price, cost_price, vendor_code, branch_code, workspace_id, on_hand",
      )
      .eq("workspace_id", callerWorkspace)
      .ilike("part_number", pn)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (partErr) throw partErr;
    if (!part) return { ok: false, reason: "part_not_found", part_number: pn };

    const unitCost = Number(part.list_price ?? part.cost_price ?? 0);
    const total = unitCost * qty;

    const { data: inserted, error: insErr } = await supabase
      .from("parts_auto_replenish_queue")
      .insert({
        workspace_id: callerWorkspace,
        part_number: part.part_number,
        branch_id: part.branch_code ?? "",
        qty_on_hand: Number(part.on_hand ?? 0),
        reorder_point: 0,
        recommended_qty: qty,
        estimated_unit_cost: unitCost,
        estimated_total: total,
        vendor_selection_reason: `Voice request by rep${note ? `: ${note}` : ""}`,
        status: "pending",
        computation_batch_id: `voice-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`,
        source_type: "manual_entry",
        forecast_driven: false,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    return {
      ok: true,
      queue_id: inserted.id,
      part_number: part.part_number,
      quantity: qty,
      estimated_total: total,
    };
  }

  if (name === "recent_orders_for_part") {
    const pn = String(input.part_number ?? "").trim();
    const limit = Number(input.limit ?? 5);
    const customerName = (input.customer_name as string | undefined) ?? null;
    if (!pn) throw new Error("part_number required");

    const { data, error } = await supabase
      .from("parts_order_lines")
      .select(
        "quantity, unit_price, part_number, parts_orders!inner(id, created_at, order_source, crm_company_id, workspace_id, crm_companies(name))",
      )
      .eq("parts_orders.workspace_id", callerWorkspace)
      .ilike("part_number", pn)
      .order("created_at", {
        referencedTable: "parts_orders",
        ascending: false,
      })
      .limit(Math.min(20, Math.max(1, limit)));
    if (error) throw error;

    const orders = (data ?? [])
      .map((row: Record<string, unknown>) => {
        const order = row.parts_orders as Record<string, unknown> | null;
        const company = order?.crm_companies as Record<string, unknown> | null;
        const customer = cleanString(company?.name) ?? "Counter/direct";
        if (
          customerName &&
          !customer.toLowerCase().includes(customerName.toLowerCase())
        ) {
          return null;
        }
        return {
          order_id: order?.id,
          created_at: order?.created_at,
          order_source: order?.order_source,
          quantity: row.quantity,
          unit_price: row.unit_price,
          customer_name: customer,
          crm_company_id: order?.crm_company_id,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return {
      ok: true,
      part_number: pn,
      customer_filter: customerName,
      orders,
    };
  }

  throw new Error(`unknown tool: ${name}`);
}

export interface PartsVoiceOpsDependencies {
  createAdminClient: () => SupabaseClient;
  resolveCallerContext: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<CallerContext>;
  getAnthropicApiKey: () => string | undefined;
  callClaude: typeof callClaude;
  embedText: typeof embedText;
}

const defaultDependencies: PartsVoiceOpsDependencies = {
  createAdminClient,
  resolveCallerContext,
  getAnthropicApiKey: () => Deno.env.get("ANTHROPIC_API_KEY"),
  callClaude,
  embedText,
};

export async function handlePartsVoiceOps(
  req: Request,
  overrides: Partial<PartsVoiceOpsDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const anthropicKey = dependencies.getAnthropicApiKey();
    if (!anthropicKey) {
      return safeJsonError("ANTHROPIC_API_KEY not set", 500, origin);
    }

    const supabase = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, supabase);

    if (!caller.userId || !caller.role) {
      return safeJsonError("Unauthorized", 401, origin);
    }
    if (!["rep", "admin", "manager", "owner"].includes(caller.role)) {
      return safeJsonError("voice ops requires rep/admin/manager/owner", 403, origin);
    }

    const body = (await req.json()) as RequestBody;
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);
    const workspaceSelection = resolveVoiceOpsWorkspace({
      callerWorkspaceId: caller.workspaceId,
      requestedWorkspaceId,
    });
    if (!workspaceSelection.ok) {
      return safeJsonError(workspaceSelection.message, workspaceSelection.status, origin);
    }
    const callerWorkspace = workspaceSelection.workspaceId;

    if (!body.transcript || body.transcript.trim().length === 0) {
      return safeJsonError("transcript is required", 400, origin);
    }
    if (body.transcript.length > 600) {
      return safeJsonError("transcript too long (>600 chars)", 400, origin);
    }

    const contextLines: string[] = [];
    if (body.context?.customer_name) {
      contextLines.push(`Current customer context: ${body.context.customer_name}`);
    }
    if (body.context?.last_part) {
      contextLines.push(`Last part the rep looked at: ${body.context.last_part}`);
    }
    if (body.context?.branch) {
      contextLines.push(`Branch: ${body.context.branch}`);
    }
    const contextBlock = contextLines.length > 0
      ? `\n\nContext:\n${contextLines.join("\n")}\n`
      : "";

    const userMessage = `${body.transcript.trim()}${contextBlock}`;

    const messages: ClaudeMessage[] = [{ role: "user", content: userMessage }];
    const toolCalls: ToolCall[] = [];
    let spokenText = "";
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await dependencies.callClaude(anthropicKey, messages);
      totalTokensIn += response.tokens_in;
      totalTokensOut += response.tokens_out;

      const toolUses = response.content.filter(
        (c): c is Extract<ClaudeMessageContent, { type: "tool_use" }> =>
          c.type === "tool_use",
      );

      if (toolUses.length === 0) {
        const textPart = response.content.find(
          (c): c is Extract<ClaudeMessageContent, { type: "text" }> =>
            c.type === "text",
        );
        spokenText = textPart?.text ?? "";
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: ClaudeMessageContent[] = [];
      for (const tu of toolUses) {
        const toolStart = Date.now();
        let resultText = "";
        let resultData: unknown = null;
        try {
          resultData = await executeVoiceOpsTool(
            supabase,
            callerWorkspace,
            tu.name,
            tu.input,
            { embedText: dependencies.embedText },
          );
          resultText = JSON.stringify(resultData);
        } catch (err) {
          resultText = JSON.stringify({ error: (err as Error).message });
        }
        toolCalls.push({
          name: tu.name,
          input: tu.input,
          result: resultData,
          elapsed_ms: Date.now() - toolStart,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultText,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    const primaryTool = toolCalls[0]?.name ?? "other";
    const intent = ({
      lookup_part_semantic: "lookup",
      check_part_stock: "lookup",
      add_to_replenish_queue: "add_to_order",
      recent_orders_for_part: "history",
    } as Record<string, string>)[primaryTool] ?? "other";

    const costCents =
      (totalTokensIn / 1_000_000) * COST_IN * 100 +
      (totalTokensOut / 1_000_000) * COST_OUT * 100;

    const elapsedMs = Date.now() - startMs;

    try {
      await supabase.from("voice_interactions").insert({
        workspace_id: callerWorkspace,
        user_id: caller.userId,
        transcript: body.transcript.trim(),
        transcript_confidence: body.transcript_confidence ?? null,
        intent,
        tool_calls: toolCalls,
        response_text: spokenText,
        client_context: body.context ?? null,
        model: CLAUDE_MODEL,
        tokens_in: totalTokensIn,
        tokens_out: totalTokensOut,
        cost_usd_cents: costCents,
        elapsed_ms: elapsedMs,
        success: spokenText.length > 0,
      });
    } catch (logErr) {
      console.warn("[parts-voice-ops] audit log failed:", logErr);
    }

    return safeJsonOk({
      ok: true,
      spoken_text: spokenText,
      intent,
      tool_calls: toolCalls,
      elapsed_ms: elapsedMs,
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      cost_usd_cents: costCents,
      workspace_id: callerWorkspace,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "parts-voice-ops" });
    return safeJsonError((err as Error).message, 500, origin);
  }
}
