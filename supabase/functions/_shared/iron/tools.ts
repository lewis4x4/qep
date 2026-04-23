/**
 * Wave 7.2 Iron Companion — agent tool registry.
 *
 * The model decides which of these to call based on the user's question.
 * Each tool has:
 *   - an Anthropic tool definition (name + description + input_schema)
 *   - a server-side executor that runs against the real Postgres tables
 *
 * Tool surface intentionally covers the operational query surface:
 *   inventory lookups, parts orders, customer/contact lookups, equipment
 *   search, service jobs, semantic KB, and web search.
 *
 * To add a new tool:
 *   1. Add a definition to IRON_TOOL_DEFINITIONS
 *   2. Add a case to executeIronTool
 *   3. Implement the executor function
 *   4. Done — the model picks it up automatically on next call
 *
 * Hard rules:
 *   - All executors are read-only. NO mutations. Mutations belong in flows
 *     so they go through iron-execute-flow-step + the undo/idempotency
 *     guard rails.
 *   - All executors filter by workspace_id from ToolContext (server-side
 *     enforcement of tenant isolation, never trust the model).
 *   - All executors return JSON-serializable results capped at ~4KB so
 *     the conversation history doesn't blow up the model context.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { embedText, formatVectorLiteral } from "../openai-embeddings.ts";
import {
  buildEvidenceExcerpt,
  rerankKbEvidence,
  type KbEvidenceRow,
} from "../kb-retrieval.ts";

/* ─── Anthropic tool definitions ────────────────────────────────────────── */

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const IRON_TOOL_DEFINITIONS: AnthropicToolDef[] = [
  {
    name: "lookup_part_inventory",
    description:
      "Look up a COMPLETE, exact part number in the catalog (e.g. '129A00-55730', 'BK-HYD-4951'). Returns description, list_price, cost_price, on_hand, bin_location, branch_code. USE ONLY WHEN the user gave you a full SKU with all suffix digits — CDK part numbers usually have dashes and multiple segments like '129A00-55730'. When exact lookup finds nothing, the response may include `candidates: [...]` with close matches from semantic search — present these to the user. DO NOT use this tool for partial numbers, fragments, or descriptions — use search_parts instead.",
    input_schema: {
      type: "object",
      properties: {
        part_number: {
          type: "string",
          description: "The EXACT, COMPLETE part number (e.g. '129A00-55730'). Not a fragment.",
        },
      },
      required: ["part_number"],
    },
  },
  {
    name: "search_parts",
    description:
      "SEMANTIC + FULL-TEXT hybrid search across the catalog. Finds parts by description, partial number, symptom, machine make/model, or fuzzy phrasing. Returns top candidates ranked by similarity + keyword match. ALWAYS USE THIS when the user gave anything less than a complete SKU — partials (e.g. '0703'), descriptions ('hydraulic filter for Yanmar'), symptoms ('chipper is stalling'), brand names ('Caterpillar filters'), or loose phrasing. Much more powerful than simple keyword matching — it understands meaning. DEFAULT TOOL for parts search.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The user's raw phrasing (partial number, description, symptom, etc.). Include machine context if the user mentioned it.",
        },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max results (default 15)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_low_stock_parts",
    description:
      "List parts whose total inventory is at or below a threshold across all branches. Returns part_number, description, total_qty, branches with low counts. USE THIS WHEN: the user asks 'what's running low', 'what do we need to reorder', 'show me parts under N units', etc.",
    input_schema: {
      type: "object",
      properties: {
        branch_id: { type: "string", description: "Optional branch filter (e.g. 'gulf-depot')" },
        threshold: { type: "number", description: "Max quantity to consider low (default 5)" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "list_parts_orders",
    description:
      "List parts orders filtered by status, date range, or urgency. Returns order id, status, total, customer company name, line items count, machine-down flag, and creation date. USE THIS WHEN: the user asks 'show me pending parts orders', 'what parts orders are open', 'urgent machine-down orders', 'orders this week', etc.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Optional status filter (e.g. 'pending', 'fulfilled', 'shipped', 'cancelled')",
        },
        days_back: { type: "number", description: "Last N days (default 30)" },
        is_machine_down: { type: "boolean", description: "Filter to machine-down (urgent) orders only" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "lookup_company",
    description:
      "Find a customer company by name (fuzzy match). Returns company id, name, address, city/state, and id. USE THIS WHEN: the user mentions a customer by name, e.g. 'find Anderson Equipment' or 'do we have a record for Acme Construction'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Company name (partial match supported)" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["name"],
    },
  },
  {
    name: "lookup_contact",
    description:
      "Find a contact person by first name, last name, or email. Returns contact id, name, email, phone, title, and primary company. USE THIS WHEN: the user mentions a person by name, e.g. 'find John Smith' or 'who is the contact at Acme'. If this returns 0 results, the person may be a prospect captured on a quote — call lookup_quote next with the same name before telling the user nothing was found.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "First name, last name, or both" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["name"],
    },
  },
  {
    name: "search_equipment",
    description:
      "Search equipment inventory by make, model, year, category, condition, or availability. Returns equipment with serial, year, hours, current market value, daily rental rate, and location. USE THIS WHEN: the user asks about equipment in stock, rental rates, or to find a specific machine, e.g. 'do we have any 2020 Bobcats' or 'show available skid steers'.",
    input_schema: {
      type: "object",
      properties: {
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "number" },
        category: { type: "string" },
        availability: {
          type: "string",
          description: "e.g. 'available', 'on_rent', 'sold', 'in_service'",
        },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "list_service_jobs",
    description:
      "List service jobs filtered by customer, stage, branch, priority, or recency. Returns job id, customer problem summary, current stage, scheduled date, branch, priority, and customer_id. USE THIS WHEN: the user asks about open service work, scheduled jobs, urgent jobs, or jobs for a specific customer. If the user mentions a customer by name in a follow-up question (e.g. 'what service jobs do they have?' after looking up a company), first get the customer_id from the prior lookup_company result and pass it here as customer_id.",
    input_schema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "UUID of the customer company (from a prior lookup_company call). Use this to filter jobs to a specific customer.",
        },
        current_stage: {
          type: "string",
          description:
            "e.g. 'request_received', 'triaging', 'diagnosis_selected', 'parts_pending', 'in_progress', 'quote_sent', 'completed'",
        },
        branch_id: { type: "string" },
        priority: {
          type: "string",
          description: "'normal', 'urgent', or 'critical' (these are the only valid values)",
        },
        open_only: {
          type: "boolean",
          description: "When true, excludes completed/invoiced jobs. Default false.",
        },
        days_back: { type: "number", description: "Last N days (default 90)" },
        limit: { type: "number", description: "Max results (default 25)" },
      },
    },
  },
  {
    name: "semantic_kb_search",
    description:
      "Semantic search over uploaded documents, manuals, SOPs, machine knowledge notes, and CRM embeddings. Use for unstructured knowledge questions like 'what's our return policy', 'how do I service a hydraulic pump', or 'what does our SOP say about trade-ins'. NOT for inventory or transactional data — use the dedicated tools for those. This tool runs a multi-tier retrieval cascade: identifier matching, semantic + keyword search, and lexical fallback — so it will find answers even if embeddings are weak.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language query" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_service_knowledge",
    description:
      "Search the verified service knowledge base — recurring field fixes, fault codes, symptoms, and technician institutional memory. Use when the user asks about a repair procedure, fault code, recurring machine problem, or field fix. Pass equipment make/model and/or fault code if known. Returns verified and unverified solutions with parts used.",
    input_schema: {
      type: "object",
      properties: {
        make: { type: "string", description: "Equipment manufacturer (e.g. 'Bandit', 'Yanmar', 'CAT')" },
        model: { type: "string", description: "Equipment model" },
        fault_code: { type: "string", description: "Fault/error code (e.g. 'E-350', 'SPN-3251')" },
        symptom: { type: "string", description: "Symptom description (used for fuzzy match if no fault code)" },
      },
    },
  },
  {
    name: "web_search",
    description:
      "Search the public web via Tavily for OEM specs, market prices, news, or any external/public information that isn't in the QEP database. USE THIS WHEN: the user asks for things like 'torque spec for a CAT 320 final drive', 'current used market price for a 2018 Bobcat T770', or 'what's the warranty period on a Kubota L4060'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Web search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_quote",
    description:
      "Find saved equipment proposals (quote packages) by customer name, company name, or quote id. Returns the quote's customer, equipment, totals, cash down, amount financed, financing scenarios, status, and the AI reasoning used to build it (which often captures budget and job context). USE THIS WHEN: the user asks about a quoted deal, a prospect who doesn't have a full CRM contact yet, or anything about numbers on a specific proposal (e.g. 'how much was John gonna put down', 'what's the budget on the Coker deal', 'which SR175 quote have we sent recently'). Falls through to this when lookup_contact returns nothing for a known prospect name.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Buyer's full or partial name (e.g. 'John Coker')" },
        customer_company: { type: "string", description: "Company name on the proposal" },
        quote_id: { type: "string", description: "Exact quote_packages.id UUID if known" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
];

/* ─── Tool execution context ────────────────────────────────────────────── */

export interface ToolContext {
  admin: SupabaseClient;
  workspaceId: string;
  userRole: string;
  tavilyApiKey: string;
  /** Stashed by the dispatcher for KB hydration — not part of the public contract */
  _lastQuery?: string;
}

/* ─── Tool dispatcher ───────────────────────────────────────────────────── */

export async function executeIronTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  try {
    switch (name) {
      case "lookup_part_inventory":
        return await toolLookupPartInventory(String(input.part_number ?? ""), ctx);
      case "search_parts":
        return await toolSearchParts(
          String(input.query ?? ""),
          input.category as string | undefined,
          (input.limit as number | undefined) ?? 15,
          ctx,
        );
      case "list_low_stock_parts":
        return await toolListLowStockParts(
          input.branch_id as string | undefined,
          (input.threshold as number | undefined) ?? 5,
          (input.limit as number | undefined) ?? 25,
          ctx,
        );
      case "list_parts_orders":
        return await toolListPartsOrders(
          input.status as string | undefined,
          (input.days_back as number | undefined) ?? 30,
          input.is_machine_down as boolean | undefined,
          (input.limit as number | undefined) ?? 25,
          ctx,
        );
      case "lookup_company":
        return await toolLookupCompany(
          String(input.name ?? ""),
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      case "lookup_contact":
        return await toolLookupContact(
          String(input.name ?? ""),
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      case "search_equipment":
        return await toolSearchEquipment(
          input.make as string | undefined,
          input.model as string | undefined,
          input.year as number | undefined,
          input.category as string | undefined,
          input.availability as string | undefined,
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      case "list_service_jobs":
        return await toolListServiceJobs(
          input.customer_id as string | undefined,
          input.current_stage as string | undefined,
          input.branch_id as string | undefined,
          input.priority as string | undefined,
          (input.open_only as boolean | undefined) ?? false,
          (input.days_back as number | undefined) ?? 90,
          (input.limit as number | undefined) ?? 25,
          ctx,
        );
      case "semantic_kb_search":
        ctx._lastQuery = String(input.query ?? "");
        return await toolSemanticKbSearch(ctx._lastQuery, ctx);
      case "search_service_knowledge":
        return await toolSearchServiceKnowledge(
          input.make as string | undefined,
          input.model as string | undefined,
          input.fault_code as string | undefined,
          input.symptom as string | undefined,
          ctx,
        );
      case "web_search":
        return await toolWebSearch(String(input.query ?? ""), ctx);
      case "lookup_quote":
        return await toolLookupQuote(
          input.customer_name as string | undefined,
          input.customer_company as string | undefined,
          input.quote_id as string | undefined,
          (input.limit as number | undefined) ?? 10,
          ctx,
        );
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[iron-tool:${name}] threw`, err);
    return { error: `tool execution failed: ${(err as Error).message}` };
  }
}

/* ─── Tool implementations ──────────────────────────────────────────────── */

async function toolLookupPartInventory(partNumber: string, ctx: ToolContext) {
  if (!partNumber) return { error: "part_number is required" };
  const trimmed = partNumber.trim().toUpperCase();
  console.log(`[iron/tools] lookup_part_inventory input="${trimmed}" workspace="${ctx.workspaceId}"`);

  // Check parts_catalog first (CDK-imported parts have on_hand here)
  const { data: catalogRows, error: catErr } = await ctx.admin
    .from("parts_catalog")
    .select("id, part_number, description, manufacturer, vendor_code, list_price, cost_price, category, uom, on_hand, bin_location, branch_code")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .or(`part_number.ilike.${trimmed},part_number.ilike.${trimmed}%,part_number.ilike.%${trimmed}%`)
    .limit(5);

  if (catErr) return { error: catErr.message };
  console.log(`[iron/tools] lookup_part_inventory exact_catalog_matches=${catalogRows?.length ?? 0}`);

  // Also check parts_inventory (legacy path)
  const { data: invRows } = await ctx.admin
    .from("parts_inventory")
    .select("part_number, branch_id, qty_on_hand, bin_location")
    .or(`part_number.eq.${trimmed},part_number.ilike.${trimmed}%`)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null);

  // Merge: prefer catalog data (CDK source of truth), supplement with inventory
  if ((!catalogRows || catalogRows.length === 0) && (!invRows || invRows.length === 0)) {
    // Soft-fallback: try semantic search with the same string as a search query.
    // This catches "0703" → finds "0703-144" / "0703-185" / etc.
    let candidates: Array<Record<string, unknown>> = [];
    try {
      const { embedText, formatVectorLiteral } = await import("../openai-embeddings.ts");
      const embedding = await embedText(trimmed);
      const vectorLiteral = formatVectorLiteral(embedding);
      const { data: hybridRows } = await ctx.admin.rpc("match_parts_hybrid", {
        p_query_embedding: vectorLiteral,
        p_query_text: trimmed,
        p_workspace: ctx.workspaceId,
        p_manufacturer: null,
        p_category: null,
        p_alpha: 0.4, // lean FTS-heavy for numeric lookups
        p_match_count: 5,
      });
      candidates = (hybridRows ?? []).map((r: Record<string, unknown>) => ({
        part_number: r.part_number,
        description: r.description,
        on_hand: r.on_hand,
        list_price: r.list_price,
        similarity: r.cosine_similarity,
        hybrid_score: r.hybrid_score,
      }));
    } catch (err) {
      console.warn(`[iron/tools] fallback semantic search failed: ${(err as Error).message}`);
    }
    console.log(`[iron/tools] lookup_part_inventory fallback_candidates=${candidates.length}`);
    return {
      found: false,
      part_number: trimmed,
      message: `No exact match for "${trimmed}".`,
      candidates,
      suggestion: candidates.length > 0
        ? `Claude: present these candidates to the user and ask which one they meant. Do NOT invent a different part number.`
        : `Claude: explain you couldn't find anything close and offer to search by description.`,
    };
  }

  if (catalogRows && catalogRows.length > 0) {
    const totalOnHand = catalogRows.reduce((sum, r) => sum + Number(r.on_hand ?? 0), 0);
    return {
      found: true,
      part_number: catalogRows[0].part_number,
      description: catalogRows[0].description ?? null,
      manufacturer: catalogRows[0].manufacturer ?? catalogRows[0].vendor_code ?? null,
      category: catalogRows[0].category ?? null,
      list_price_usd: catalogRows[0].list_price ?? null,
      cost_price_usd: catalogRows[0].cost_price ?? null,
      unit_of_measure: catalogRows[0].uom ?? null,
      total_on_hand: totalOnHand,
      bin_location: catalogRows[0].bin_location ?? null,
      branch_code: catalogRows[0].branch_code ?? null,
      matches: catalogRows.length,
      all_matches: catalogRows.map((r) => ({
        part_number: r.part_number,
        description: r.description,
        on_hand: r.on_hand,
        bin_location: r.bin_location,
        branch_code: r.branch_code,
        list_price: r.list_price,
      })),
    };
  }

  // Fallback: inventory-only (no catalog match)
  const total = (invRows ?? []).reduce((sum, r) => sum + (r.qty_on_hand ?? 0), 0);
  return {
    found: true,
    part_number: trimmed,
    total_on_hand: total,
    branch_count: (invRows ?? []).length,
    branches: (invRows ?? []).map((r) => ({
      branch_id: r.branch_id,
      qty: r.qty_on_hand,
      bin_location: r.bin_location,
    })),
  };
}

async function toolSearchParts(
  query: string,
  category: string | undefined,
  limit: number,
  ctx: ToolContext,
) {
  if (!query) return { error: "query is required" };
  const term = query.trim().slice(0, 80);
  console.log(`[iron/tools] search_parts query="${term}" workspace="${ctx.workspaceId}" category="${category ?? "none"}"`);

  // Try semantic + FTS hybrid search first (Slice 3.1 match_parts_hybrid)
  try {
    const { embedText, formatVectorLiteral } = await import("../openai-embeddings.ts");
    const embedding = await embedText(term);
    const vectorLiteral = formatVectorLiteral(embedding);

    const { data: hybridResults, error: hybridErr } = await ctx.admin.rpc("match_parts_hybrid", {
      p_query_embedding: vectorLiteral,
      p_query_text: term,
      p_workspace: ctx.workspaceId,
      p_manufacturer: null,
      p_category: category ?? null,
      p_alpha: 0.6,
      p_match_count: Math.min(limit, 20),
    });

    if (hybridErr) {
      console.warn(`[iron/tools] match_parts_hybrid RPC error: ${hybridErr.message}`);
    }

    if (!hybridErr && hybridResults && hybridResults.length > 0) {
      console.log(`[iron/tools] search_parts semantic_hybrid matches=${hybridResults.length}`);
      return {
        count: hybridResults.length,
        search_method: "semantic_hybrid",
        parts: hybridResults.map((p: Record<string, unknown>) => ({
          part_number: p.part_number,
          description: p.description,
          manufacturer: p.manufacturer ?? p.vendor_code,
          category: p.category,
          list_price_usd: p.list_price,
          on_hand: p.on_hand,
          similarity: p.cosine_similarity,
          hybrid_score: p.hybrid_score,
        })),
      };
    }
  } catch (embErr) {
    // Embedding failed (OPENAI_API_KEY missing, network, etc.) — fall through to ilike
    console.warn("[iron/tools] semantic search fallback:", (embErr as Error).message);
  }

  // Fallback: ilike search on parts_catalog (also checks on_hand from catalog, not parts_inventory)
  const safeTerm = term.replace(/[%_]/g, "");
  const orFilter = `description.ilike.%${safeTerm}%,manufacturer.ilike.%${safeTerm}%,vendor_code.ilike.%${safeTerm}%,part_number.ilike.%${safeTerm}%`;

  let q = ctx.admin
    .from("parts_catalog")
    .select("part_number, description, manufacturer, vendor_code, category, list_price, cost_price, uom, on_hand, bin_location")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .or(orFilter);
  if (category) q = q.eq("category", category);

  const { data, error } = await q.limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    console.log(`[iron/tools] search_parts ilike_fallback matches=0`);
    return { count: 0, parts: [], search_method: "ilike_fallback", message: `No parts found for "${term}". Tell the user what you searched and ask them to try a different phrasing.` };
  }
  console.log(`[iron/tools] search_parts ilike_fallback matches=${data.length}`);

  return {
    count: data.length,
    search_method: "ilike_fallback",
    parts: data.map((p) => ({
      part_number: p.part_number,
      description: p.description,
      manufacturer: p.manufacturer ?? p.vendor_code,
      category: p.category,
      list_price_usd: p.list_price,
      on_hand: p.on_hand ?? 0,
    })),
  };
}

async function toolListLowStockParts(
  branchId: string | undefined,
  threshold: number,
  limit: number,
  ctx: ToolContext,
) {
  let q = ctx.admin
    .from("parts_inventory")
    .select("part_number, branch_id, qty_on_hand, bin_location")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .lte("qty_on_hand", Math.max(0, threshold))
    .order("qty_on_hand", { ascending: true });
  if (branchId) q = q.eq("branch_id", branchId);

  const { data, error } = await q.limit(Math.min(limit, 100));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, low_stock: [] };

  // Hydrate descriptions
  const partNumbers = Array.from(new Set(data.map((r) => r.part_number)));
  const { data: catalog } = await ctx.admin
    .from("parts_catalog")
    .select("part_number, description, manufacturer, list_price")
    .in("part_number", partNumbers)
    .eq("workspace_id", ctx.workspaceId);

  const descByPart = new Map<string, { description: string | null; manufacturer: string | null; list_price: number | null }>();
  for (const c of catalog ?? []) {
    descByPart.set(c.part_number, {
      description: c.description ?? null,
      manufacturer: c.manufacturer ?? null,
      list_price: c.list_price ?? null,
    });
  }

  return {
    threshold,
    branch_filter: branchId ?? null,
    count: data.length,
    low_stock: data.map((r) => ({
      part_number: r.part_number,
      description: descByPart.get(r.part_number)?.description ?? null,
      manufacturer: descByPart.get(r.part_number)?.manufacturer ?? null,
      branch_id: r.branch_id,
      qty: r.qty_on_hand,
      bin_location: r.bin_location,
    })),
  };
}

async function toolListPartsOrders(
  status: string | undefined,
  daysBack: number,
  isMachineDown: boolean | undefined,
  limit: number,
  ctx: ToolContext,
) {
  const since = new Date(Date.now() - Math.max(1, daysBack) * 86400_000).toISOString();
  let q = ctx.admin
    .from("parts_orders")
    .select(
      "id, status, total, subtotal, is_machine_down, crm_company_id, created_at, estimated_delivery, tracking_number, line_items, notes",
    )
    .eq("workspace_id", ctx.workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (typeof isMachineDown === "boolean") q = q.eq("is_machine_down", isMachineDown);

  const { data, error } = await q.limit(Math.min(limit, 50));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, orders: [] };

  // Hydrate company names
  const companyIds = Array.from(new Set(data.map((o) => o.crm_company_id).filter(Boolean) as string[]));
  let companyById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await ctx.admin
      .from("qrm_companies")
      .select("id, name")
      .in("id", companyIds);
    for (const c of companies ?? []) companyById.set(c.id, c.name);
  }

  return {
    filter: { status, days_back: daysBack, is_machine_down: isMachineDown },
    count: data.length,
    orders: data.map((o) => ({
      id: o.id,
      status: o.status,
      total_usd: o.total,
      is_machine_down: o.is_machine_down,
      customer: o.crm_company_id ? companyById.get(o.crm_company_id) ?? null : null,
      created_at: o.created_at,
      estimated_delivery: o.estimated_delivery,
      tracking_number: o.tracking_number,
      line_count: Array.isArray(o.line_items) ? (o.line_items as unknown[]).length : 0,
      notes: o.notes ? String(o.notes).slice(0, 200) : null,
    })),
  };
}

async function toolLookupCompany(name: string, limit: number, ctx: ToolContext) {
  if (!name) return { error: "name is required" };
  const term = `%${name.replace(/[%_]/g, "").slice(0, 80)}%`;
  const { data, error } = await ctx.admin
    .from("qrm_companies")
    .select("id, name, city, state, postal_code, country, address_line_1")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .ilike("name", term)
    .order("name")
    .limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  return { count: data?.length ?? 0, companies: data ?? [] };
}

async function toolLookupContact(name: string, limit: number, ctx: ToolContext) {
  if (!name) return { error: "name is required" };
  const term = `%${name.replace(/[%_]/g, "").slice(0, 80)}%`;
  const orFilter = `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`;
  const { data, error } = await ctx.admin
    .from("qrm_contacts")
    .select("id, first_name, last_name, email, phone, title, primary_company_id")
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .or(orFilter)
    .limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, contacts: [] };

  const companyIds = Array.from(
    new Set(data.map((c) => c.primary_company_id).filter(Boolean) as string[]),
  );
  let companyById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await ctx.admin
      .from("qrm_companies")
      .select("id, name")
      .in("id", companyIds);
    for (const c of companies ?? []) companyById.set(c.id, c.name);
  }

  return {
    count: data.length,
    contacts: data.map((c) => ({
      id: c.id,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      email: c.email,
      phone: c.phone,
      title: c.title,
      company: c.primary_company_id ? companyById.get(c.primary_company_id) ?? null : null,
    })),
  };
}

async function toolLookupQuote(
  customerName: string | undefined,
  customerCompany: string | undefined,
  quoteId: string | undefined,
  limit: number,
  ctx: ToolContext,
) {
  if (!customerName && !customerCompany && !quoteId) {
    return { error: "customer_name, customer_company, or quote_id is required" };
  }
  let q = ctx.admin
    .from("quote_packages")
    .select(
      "id, deal_id, contact_id, customer_name, customer_company, customer_email, customer_phone, status, quote_number, branch_slug, equipment, attachments_included, subtotal, discount_total, trade_credit, net_total, tax_total, cash_down, amount_financed, customer_total, selected_finance_scenario, financing_scenarios, ai_recommendation, created_at, updated_at, sent_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 25));
  if (quoteId) {
    q = q.eq("id", quoteId);
  } else {
    const filters: string[] = [];
    if (customerName) {
      const term = customerName.replace(/[%_]/g, "").slice(0, 80);
      filters.push(`customer_name.ilike.%${term}%`);
    }
    if (customerCompany) {
      const term = customerCompany.replace(/[%_]/g, "").slice(0, 80);
      filters.push(`customer_company.ilike.%${term}%`);
    }
    if (filters.length === 0) return { count: 0, quotes: [] };
    q = q.or(filters.join(","));
  }
  const { data, error } = await q;
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { count: 0, quotes: [] };

  const shapedQuotes = data.map((row: Record<string, unknown>) => {
    const equipment = Array.isArray(row.equipment) ? row.equipment : [];
    const primary = equipment[0] as Record<string, unknown> | undefined;
    const primaryLabel = primary
      ? [primary.make, primary.model, primary.year ? `(${primary.year})` : null]
        .filter(Boolean).join(" ")
      : "(no equipment)";
    const scenarios = Array.isArray(row.financing_scenarios) ? row.financing_scenarios : [];
    const selectedLabel = typeof row.selected_finance_scenario === "string"
      ? row.selected_finance_scenario
      : null;
    const selected = scenarios.find((s: Record<string, unknown>) =>
      typeof s.label === "string" && s.label === selectedLabel,
    ) ?? scenarios[0] ?? null;
    const rec = row.ai_recommendation && typeof row.ai_recommendation === "object"
      ? row.ai_recommendation as Record<string, unknown>
      : null;
    return {
      id: row.id,
      quote_number: row.quote_number ?? null,
      status: row.status ?? "draft",
      customer_name: row.customer_name ?? null,
      customer_company: row.customer_company ?? null,
      customer_email: row.customer_email ?? null,
      customer_phone: row.customer_phone ?? null,
      deal_id: row.deal_id ?? null,
      branch_slug: row.branch_slug ?? null,
      primary_equipment: primaryLabel,
      equipment_count: equipment.length,
      attachments: Array.isArray(row.attachments_included)
        ? (row.attachments_included as Array<Record<string, unknown>>)
          .map((a) => a?.name).filter((n) => typeof n === "string")
        : [],
      subtotal: row.subtotal ?? null,
      discount_total: row.discount_total ?? null,
      trade_credit: row.trade_credit ?? null,
      net_total: row.net_total ?? null,
      tax_total: row.tax_total ?? null,
      cash_down: row.cash_down ?? null,
      amount_financed: row.amount_financed ?? null,
      customer_total: row.customer_total ?? null,
      selected_financing: selected
        ? {
          label: (selected as Record<string, unknown>).label ?? null,
          term_months: (selected as Record<string, unknown>).term_months ?? null,
          apr: (selected as Record<string, unknown>).apr ?? (selected as Record<string, unknown>).rate ?? null,
          monthly_payment: (selected as Record<string, unknown>).monthly_payment ?? null,
        }
        : null,
      reasoning: rec && typeof rec.reasoning === "string" ? rec.reasoning : null,
      job_facts: rec && Array.isArray(rec.jobFacts) ? rec.jobFacts : null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      sent_at: row.sent_at ?? null,
    };
  });

  return { count: shapedQuotes.length, quotes: shapedQuotes };
}

async function toolSearchEquipment(
  make: string | undefined,
  model: string | undefined,
  year: number | undefined,
  category: string | undefined,
  availability: string | undefined,
  limit: number,
  ctx: ToolContext,
) {
  let q = ctx.admin
    .from("qrm_equipment")
    .select(
      "id, name, asset_tag, serial_number, make, model, year, category, condition, availability, engine_hours, current_market_value, daily_rental_rate, location_description",
    )
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .order("year", { ascending: false });
  if (make) q = q.ilike("make", `%${make}%`);
  if (model) q = q.ilike("model", `%${model}%`);
  if (year) q = q.eq("year", year);
  if (category) q = q.eq("category", category);
  if (availability) q = q.eq("availability", availability);

  const { data, error } = await q.limit(Math.min(limit, 25));
  if (error) return { error: error.message };
  return { count: data?.length ?? 0, equipment: data ?? [] };
}

async function toolListServiceJobs(
  customerId: string | undefined,
  currentStage: string | undefined,
  branchId: string | undefined,
  priority: string | undefined,
  openOnly: boolean,
  daysBack: number,
  limit: number,
  ctx: ToolContext,
) {
  const since = new Date(Date.now() - Math.max(1, daysBack) * 86400_000).toISOString();
  let q = ctx.admin
    .from("service_jobs")
    .select(
      "id, current_stage, priority, branch_id, customer_problem_summary, scheduled_start_at, scheduled_end_at, quote_total, invoice_total, requested_by_name, customer_id, machine_id, created_at",
    )
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (customerId) q = q.eq("customer_id", customerId);
  if (currentStage) q = q.eq("current_stage", currentStage);
  if (branchId) q = q.eq("branch_id", branchId);
  if (priority) q = q.eq("priority", priority);
  if (openOnly) {
    q = q.not("current_stage", "in", '("completed","invoiced","closed")');
  }

  const { data, error } = await q.limit(Math.min(limit, 50));
  if (error) return { error: error.message };

  // Hydrate customer names so the model can write human-readable answers
  const customerIds = Array.from(
    new Set((data ?? []).map((j) => j.customer_id).filter(Boolean) as string[]),
  );
  let customerNameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: companies } = await ctx.admin
      .from("qrm_companies")
      .select("id, name")
      .in("id", customerIds);
    for (const c of companies ?? []) customerNameById.set(c.id, c.name);
  }

  return {
    count: data?.length ?? 0,
    jobs: (data ?? []).map((j) => ({
      ...j,
      customer_name: j.customer_id ? customerNameById.get(j.customer_id) ?? null : null,
    })),
  };
}

/* ─── KB retrieval helpers (ported from chat/index.ts) ──────────────── */

const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "can", "do", "does", "for", "how", "i",
  "in", "is", "it", "me", "of", "on", "or", "our", "please", "qep",
  "show", "tell", "the", "to", "us", "we", "what", "where", "which",
  "who", "why", "with",
]);

function truncateKbText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function simplifyQuestion(message: string): string {
  return message
    .trim()
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/\?+$/g, "")
    .replace(
      /^(what|where|which|who|why|how)\s+(is|are|was|were|do|does|did|can|could|should|would|were)\s+/i,
      "",
    )
    .replace(/^(tell me about|show me|explain|summarize|describe|find|give me)\s+/i, "")
    .replace(/^(the|our)\s+/i, "")
    .trim();
}

function extractSearchTokens(message: string): string[] {
  const normalized = normalizeSearchText(message);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(" ")) {
    if (token.length < 3 || QUERY_STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function buildKeywordCandidates(message: string): string[] {
  const candidates: string[] = [];
  const raw = message.trim();
  const simplified = simplifyQuestion(raw);
  const tokenPhrase = extractSearchTokens(raw).slice(0, 6).join(" ");
  for (const candidate of [raw, simplified, tokenPhrase]) {
    if (!candidate) continue;
    const normalized = candidate.trim();
    if (!normalized || candidates.includes(normalized)) continue;
    candidates.push(normalized);
  }
  return candidates;
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractIdentifierCandidates(message: string): string[] {
  const seen = new Set<string>();
  const matches = message.match(/\b[a-z0-9]{2,}(?:[-/][a-z0-9]{2,})+\b/gi) ?? [];
  const identifiers: string[] = [];
  for (const match of matches) {
    const trimmed = match.trim();
    const normalized = normalizeIdentifier(trimmed);
    if (normalized.length < 5 || seen.has(normalized)) continue;
    seen.add(normalized);
    identifiers.push(trimmed);
  }
  return identifiers;
}

function excerptAroundToken(text: string, token: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  const index = lower.indexOf(token.toLowerCase());
  if (index < 0) return truncateKbText(normalized, 800);
  const start = Math.max(0, index - 200);
  return truncateKbText(normalized.slice(start, start + 800), 800);
}

function excerptAroundIdentifier(text: string, identifier: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  const target = normalizeIdentifier(identifier);
  const matchingIndex = lines.findIndex((l) => normalizeIdentifier(l).includes(target));
  if (matchingIndex < 0) return excerptAroundToken(text, identifier);
  const start = Math.max(0, matchingIndex - 1);
  const end = Math.min(lines.length, matchingIndex + 3);
  return truncateKbText(lines.slice(start, end).join("\n"), 1200);
}

type DocumentAudience = "company_wide" | "finance" | "leadership" | "admin_owner" | "owner_only";

function allowedAudiencesForRole(role: string): DocumentAudience[] {
  if (role === "owner") return ["company_wide", "finance", "leadership", "admin_owner", "owner_only"];
  if (role === "manager") return ["company_wide", "finance", "leadership"];
  if (role === "admin") return ["company_wide", "finance", "admin_owner"];
  return ["company_wide"];
}

/* ─── toolSemanticKbSearch — multi-tier retrieval cascade ──────────── */

async function toolSemanticKbSearch(query: string, ctx: ToolContext) {
  if (!query) return { error: "query is required" };

  // ── Tier 0: Identifier matching (part numbers, model codes) ────────
  const identifierCandidates = extractIdentifierCandidates(query);
  if (identifierCandidates.length > 0) {
    const identifierResults = await tryIdentifierMatch(identifierCandidates, ctx);
    if (identifierResults && identifierResults.length > 0) {
      return { count: identifierResults.length, retrieval_tier: "identifier", results: identifierResults };
    }
  }

  // ── Tier 1: Semantic + keyword with candidate retry ────────────────
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(query);
  } catch (err) {
    console.warn(`[iron.tools.semantic_kb_search] embedding failed, continuing with keyword-only: ${(err as Error).message}`);
  }

  const keywordCandidates = buildKeywordCandidates(query);
  for (const keywordQuery of keywordCandidates) {
    const { data, error } = await ctx.admin.rpc("retrieve_document_evidence", {
      query_embedding: embedding ? formatVectorLiteral(embedding) : null,
      keyword_query: keywordQuery.slice(0, 200),
      user_role: ctx.userRole,
      match_count: 12,
      semantic_match_threshold: 0.45,
      p_workspace_id: ctx.workspaceId,
    });

    if (error) {
      console.warn(`[iron.tools.semantic_kb_search] rpc failed for keyword="${keywordQuery}": ${error.message}`);
      continue;
    }

    if (!Array.isArray(data) || data.length === 0) continue;

    const ranked = await rerankKbEvidence(
      keywordQuery,
      data as KbEvidenceRow[],
      { loggerTag: "iron.tools.semantic_kb_search" },
    );

    if (ranked.length === 0) continue;

    // Hydrate full document text for single-hit results
    const hydratedResults = await hydrateKbResults(ranked, ctx);
    return { count: hydratedResults.length, retrieval_tier: "semantic", results: hydratedResults };
  }

  // ── Tier 2: Lexical fallback (token scoring against raw documents) ─
  const lexicalResults = await tryLexicalFallback(query, ctx);
  if (lexicalResults && lexicalResults.length > 0) {
    return { count: lexicalResults.length, retrieval_tier: "lexical", results: lexicalResults };
  }

  return { count: 0, retrieval_tier: "none", results: [] };
}

/** Tier 0: Direct string matching against document titles and raw_text */
async function tryIdentifierMatch(
  identifierCandidates: string[],
  ctx: ToolContext,
): Promise<Array<Record<string, unknown>> | null> {
  const { data: docs, error } = await ctx.admin
    .from("documents")
    .select("id, title, raw_text, audience, updated_at")
    .eq("status", "published")
    .in("audience", allowedAudiencesForRole(ctx.userRole))
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !docs || docs.length === 0) return null;

  type DocRow = { id: string; title: string; raw_text: string | null; audience: string; updated_at: string };
  const scored = (docs as DocRow[])
    .map((doc) => {
      const normalizedTitle = normalizeIdentifier(doc.title ?? "");
      const normalizedRaw = normalizeIdentifier(doc.raw_text ?? "");
      let matchedIdentifier: string | null = null;
      let score = 0;
      for (const identifier of identifierCandidates) {
        const normalized = normalizeIdentifier(identifier);
        if (normalizedTitle.includes(normalized)) { matchedIdentifier = identifier; score = Math.max(score, 7); }
        if (normalizedRaw.includes(normalized)) { matchedIdentifier = identifier; score = Math.max(score, 10); }
      }
      if (!matchedIdentifier || score === 0) return null;
      return { doc, matchedIdentifier, score, excerpt: excerptAroundIdentifier(doc.raw_text || doc.title, matchedIdentifier) };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score || b.doc.updated_at.localeCompare(a.doc.updated_at))
    .slice(0, 3);

  if (scored.length === 0) return null;

  return scored.map(({ doc, score, excerpt }) => ({
    kind: "document",
    id: doc.id,
    title: doc.title,
    excerpt,
    confidence: Math.min(0.99, 0.84 + score * 0.012),
  }));
}

/** Hydrate full document text for single-hit results, expand excerpts for multi-hit */
async function hydrateKbResults(
  ranked: KbEvidenceRow[],
  ctx: ToolContext,
): Promise<Array<Record<string, unknown>>> {
  const hitDocIds = ranked.map((r) => r.source_id).filter(Boolean);
  const { data: hitDocs } = await ctx.admin
    .from("documents")
    .select("id, title, raw_text, audience, updated_at")
    .in("id", hitDocIds)
    .eq("workspace_id", ctx.workspaceId);

  type DocRow = { id: string; title: string; raw_text: string | null; audience: string; updated_at: string };
  const hydratedById = new Map<string, DocRow>();
  for (const doc of (hitDocs ?? []) as DocRow[]) {
    hydratedById.set(doc.id, doc);
  }

  const isSingleHit = ranked.length === 1;
  const searchTokens = extractSearchTokens(ctx._lastQuery ?? "");

  return ranked.map((row) => {
    const doc = hydratedById.get(row.source_id);
    let excerpt = buildEvidenceExcerpt(row);

    // Single-hit: inject full document text so the model has the complete answer
    if (isSingleHit && doc?.raw_text?.trim() && !row.context_excerpt && !row.section_title) {
      excerpt = truncateKbText(doc.raw_text, 12000);
    }
    // Multi-hit: if the chunk excerpt is sparse, try to find a better excerpt using search tokens
    else if (doc?.raw_text && !row.context_excerpt && !row.section_title) {
      const matchingToken = searchTokens.find((t) => doc.raw_text?.toLowerCase().includes(t));
      if (matchingToken) {
        excerpt = excerptAroundToken(doc.raw_text, matchingToken);
      }
    }

    return {
      kind: row.source_type ?? "document",
      id: row.source_id ?? null,
      title: row.source_title ?? "Untitled",
      excerpt: excerpt.slice(0, isSingleHit ? 12000 : 2400),
      confidence: Number(row.confidence ?? 0),
      chunk_kind: row.chunk_kind ?? null,
      section_title: row.section_title ?? null,
      page_number: typeof row.page_number === "number" ? row.page_number : null,
      context_excerpt: row.context_excerpt ?? null,
    };
  });
}

/** Tier 2: Full-text token scoring when semantic search returns nothing */
async function tryLexicalFallback(
  query: string,
  ctx: ToolContext,
): Promise<Array<Record<string, unknown>> | null> {
  const searchTokens = extractSearchTokens(query);
  if (searchTokens.length === 0) return null;

  const { data: docs, error } = await ctx.admin
    .from("documents")
    .select("id, title, raw_text, audience, updated_at")
    .eq("status", "published")
    .in("audience", allowedAudiencesForRole(ctx.userRole))
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(150);

  if (error || !docs || docs.length === 0) return null;

  type DocRow = { id: string; title: string; raw_text: string | null; audience: string; updated_at: string };
  const scored = (docs as DocRow[])
    .map((doc) => {
      const titleLower = (doc.title ?? "").toLowerCase();
      const rawLower = (doc.raw_text ?? "").toLowerCase();
      let score = 0;
      let matched = 0;
      for (const token of searchTokens) {
        if (titleLower.includes(token)) { score += 3; matched += 1; }
        else if (rawLower.includes(token)) { score += 1; matched += 1; }
      }
      if (matched === 0) return null;
      const excerptSource = doc.raw_text || doc.title;
      const excerptToken = searchTokens.find((t) => rawLower.includes(t) || titleLower.includes(t)) ?? searchTokens[0];
      return { doc, matched, score, excerpt: excerptAroundToken(excerptSource, excerptToken) };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score || b.matched - a.matched || b.doc.updated_at.localeCompare(a.doc.updated_at))
    .slice(0, 3);

  if (scored.length === 0) return null;

  // For single-hit lexical match, hydrate full document text
  const isSingleHit = scored.length === 1;

  return scored.map(({ doc, matched, score, excerpt }) => ({
    kind: "document",
    id: doc.id,
    title: doc.title,
    excerpt: isSingleHit && doc.raw_text?.trim()
      ? truncateKbText(doc.raw_text, 12000)
      : excerpt,
    confidence: Math.min(0.92, 0.62 + matched * 0.08 + Math.min(score, 6) * 0.02),
  }));
}

/* ─── toolSearchServiceKnowledge ──────────────────────────────────── */

async function toolSearchServiceKnowledge(
  make: string | undefined,
  model: string | undefined,
  faultCode: string | undefined,
  symptom: string | undefined,
  ctx: ToolContext,
) {
  // Extract fault code from symptom text if not provided directly
  let resolvedFaultCode = faultCode?.trim() || null;
  if (!resolvedFaultCode && symptom) {
    const match = symptom.match(/\b[A-Z]{1,4}[- ]?\d{2,5}\b/);
    resolvedFaultCode = match?.[0]?.replace(/\s+/g, "-") ?? null;
  }

  if (!resolvedFaultCode && !make && !model) {
    return { error: "At least one of make, model, or fault_code is required" };
  }

  const { data, error } = await ctx.admin.rpc("match_service_knowledge", {
    p_make: make?.trim() || null,
    p_model: model?.trim() || null,
    p_fault_code: resolvedFaultCode,
    p_limit: 8,
  });

  if (error) return { error: error.message };
  if (!Array.isArray(data) || data.length === 0) {
    return { count: 0, results: [], message: "No matching service knowledge found." };
  }

  type ServiceKbRow = {
    id: string;
    make: string | null;
    model: string | null;
    fault_code: string | null;
    symptom: string;
    solution: string;
    parts_used: unknown[] | null;
    verified: boolean;
    use_count: number;
  };

  return {
    count: data.length,
    results: (data as ServiceKbRow[]).map((row) => ({
      id: row.id,
      equipment: [row.make, row.model].filter(Boolean).join(" ") || null,
      fault_code: row.fault_code,
      symptom: row.symptom,
      solution: row.solution,
      parts_used: Array.isArray(row.parts_used) && row.parts_used.length > 0
        ? row.parts_used
        : null,
      verified: row.verified,
      use_count: row.use_count,
      confidence: row.verified ? "verified_fix" : "unverified_field_knowledge",
    })),
  };
}

async function toolWebSearch(query: string, ctx: ToolContext) {
  if (!query) return { error: "query is required" };
  if (!ctx.tavilyApiKey) return { error: "TAVILY_API_KEY not configured on this function" };

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: ctx.tavilyApiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { error: `tavily ${res.status}` };
    }
    const payload = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const results = (payload.results ?? []).slice(0, 5).map((r) => ({
      title: String(r.title ?? r.url ?? "Web result"),
      url: String(r.url ?? ""),
      excerpt: String(r.content ?? r.snippet ?? "").slice(0, 600),
    }));
    return { count: results.length, results };
  } catch (err) {
    return { error: `web search failed: ${(err as Error).message}` };
  }
}
